import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { AccessController } from '../src/modules/AccessControl/infra/AccessController';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { db } from '../src/infrastructure/database/datastore';

vi.mock('../src/modules/Sync/application/AttachmentService', () => ({
    AttachmentService: {
        processBase64Attachment: vi.fn().mockResolvedValue('fake/path.jpg')
    }
}));

// Mock CorrelativeGenerator
vi.mock('../src/shared/CorrelativeGenerator', () => ({
    CorrelativeGenerator: {
        nextStayTicket: vi.fn().mockResolvedValue('T-001'),
        nextReceiptNumber: vi.fn().mockResolvedValue('R-001')
    }
}));

// Mock StorageEngine to return SQLITE
vi.mock('../src/infrastructure/database/StorageEngine', () => ({
    StorageEngine: {
        getEngine: vi.fn().mockReturnValue('SQLITE')
    }
}));

describe('Access Exit Flow Regression & Hardening', () => {
    let controller: AccessController;
    let sqliteDb: any;
    const garageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02'; // Valid UUID
    const ownerId = '36242d42-5fa8-4c93-ae14-23a8f6884377';  // Valid UUID

    beforeAll(() => {
        process.env.STORAGE_ENGINE = 'SQLITE'; // Force SQLite engine for tests
        SQLiteManager.getInstance().getDatabase();
        sqliteDb = SQLiteManager.getInstance().getDatabase();
        controller = new AccessController();

        // Seed Garage Config in NeDB mock (used by db.garages)
        db.garages.findOne = vi.fn().mockResolvedValue({ id: garageId, owner_id: ownerId });
    });

    afterEach(() => {
        sqliteDb.prepare('DELETE FROM stays').run();
        sqliteDb.prepare('DELETE FROM movements').run();
        sqliteDb.prepare('DELETE FROM outbox_events').run();
        sqliteDb.prepare('DELETE FROM vehicles').run();
        sqliteDb.prepare('DELETE FROM subscriptions').run();
    });

    const createMockReqRes = (body: any = {}) => {
        const req = {
            body,
            headers: { 'x-garage-id': garageId }
        } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as any;
        return { req, res };
    };

    it('T1/T2: New entry should persist ownerId properly, and exit should succeed', async () => {
        const { req, res } = createMockReqRes({ plate: 'NEW001' });
        await controller.registerEntry(req, res);
        
        expect(res.status).toHaveBeenCalledWith(201);
        
        const stayRow = sqliteDb.prepare('SELECT * FROM stays').all();
        console.log("ALL STAYS:", stayRow);
        const stayData = JSON.parse(stayRow[0].json_data);
        expect(stayData.ownerId).toBe(ownerId); // Ensured by fix

        const { req: reqExit, res: resExit } = createMockReqRes({ plate: 'NEW001', paymentMethod: 'Efectivo' });
        
        // Mock price matrix for exit
        db.prices.find = vi.fn().mockResolvedValue([{ vehicleTypeId: 'v1', amount: 500 }]);
        db.vehicleTypes.find = vi.fn().mockResolvedValue([{ id: 'v1', name: 'Auto' }]);
        db.tariffs.find = vi.fn().mockResolvedValue([{ id: 't1', name: 'Normal' }]);
        db.financialConfigs.find = vi.fn().mockResolvedValue([]);

        await controller.registerExit(reqExit, resExit);
        expect(resExit.status).not.toHaveBeenCalledWith(500);
        expect(resExit.json).toHaveBeenCalled();
        
        const exitData = resExit.json.mock.calls[0][0];
        expect(exitData.stay.active).toBe(false);
    });

    it('T3/T4: Fallback for Legacy Stays (ownerId = null)', async () => {
        const legacyId = 'e28a3f81-5917-4712-9c1a-5f04a625a587';
        // Manually insert legacy stay
        sqliteDb.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run(
            legacyId, 
            JSON.stringify({
                id: legacyId,
                plate: 'LEGACY',
                garageId,
                ownerId: null, // The problematic data
                entryTime: new Date(Date.now() - 3600000).toISOString(),
                active: true,
                isSubscriber: false
            })
        );

        const { req, res } = createMockReqRes({ plate: 'LEGACY', paymentMethod: 'Efectivo' });
        await controller.registerExit(req, res);

        expect(res.status).not.toHaveBeenCalledWith(500);
        
        const closedStay = res.json.mock.calls[0][0].stay;
        expect(closedStay.ownerId).toBe(ownerId); // Correctly fallen back from db.garages
        expect(closedStay.active).toBe(false);
    });

    it('T10/T6: Atomicity & 1 Movement Generation', async () => {
        const { req: reqEntry, res: resEntry } = createMockReqRes({ plate: 'ATOMIC' });
        await controller.registerEntry(reqEntry, resEntry);

        sqliteDb.prepare(`UPDATE stays SET json_data = json_set(json_data, '$.entryTime', ?) WHERE id = ?`).run(
            new Date(Date.now() - 7200000).toISOString(),
            JSON.parse(sqliteDb.prepare('SELECT json_data FROM stays').get().json_data).id
        );

        const { req, res } = createMockReqRes({ plate: 'ATOMIC', paymentMethod: 'Efectivo' });
        // Mock price matrix for exit
        db.prices.find = vi.fn().mockResolvedValue([{ vehicleTypeId: 'v1', amount: 500 }]);
        db.vehicleTypes.find = vi.fn().mockResolvedValue([{ id: 'v1', name: 'Auto' }]);
        db.tariffs.find = vi.fn().mockResolvedValue([{ id: 't1', name: 'Normal' }]);
        db.financialConfigs.find = vi.fn().mockResolvedValue([]);
        await controller.registerExit(req, res);

        const movs = sqliteDb.prepare('SELECT count(*) as count FROM movements').get();
        expect(movs.count).toBe(1);

        const outbox = sqliteDb.prepare('SELECT count(*) as count FROM outbox_events').get();
        // 1 for Entry Stay, 1 for Vehicle, 1 for Exit Stay, 1 for Exit Movement
        expect(outbox.count).toBeGreaterThanOrEqual(3); 
    });
});
