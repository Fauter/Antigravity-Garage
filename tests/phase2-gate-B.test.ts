import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { DATA_DIR, db as nedb } from '../src/infrastructure/database/datastore';
import { StayRepository } from '../src/modules/AccessControl/infra/StayRepository';
import { MovementRepository } from '../src/modules/Billing/infra/MovementRepository';

describe('GATE B - Repositories Proxy & Atomic Outbox', () => {
    let testDbPath: string;

    beforeAll(() => {
        const testDir = path.join(DATA_DIR, 'test');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        testDbPath = path.join(testDir, `test_gate_b_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);
        SQLiteManager.initForTest(testDbPath);
    });

    afterAll(() => {
        StorageEngine.setEngine('NEDB');
        SQLiteManager.resetInstance();
        if (testDbPath && fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch (e) {}
        }
    });

    it('TEST B3: Repository rutea a NeDB si Engine == NEDB', async () => {
        StorageEngine.setEngine('NEDB');
        const repo = new StayRepository();
        
        const stay = await repo.save({ plate: 'NEDB-123', entryTime: new Date() } as any);
        expect(stay.id).toBeDefined();

        // Check if NeDB actually has it
        const doc = await nedb.stays.findOne({ id: stay.id });
        expect(doc).toBeDefined();
        expect(doc.plate).toBe('NEDB-123');
    });

    it('TEST B1 & B2: Repository SQLite escribe dominio y outbox atómicamente', async () => {
        StorageEngine.setEngine('SQLITE');
        SQLiteManager.resetInstance(); // Reload to pick up SQLITE
        
        const repo = new StayRepository();
        const stay = await repo.save({ plate: 'SQL-456', entryTime: new Date() } as any);
        expect(stay.id).toBeDefined();

        const sqliteDb = SQLiteManager.getInstance().getDatabase();
        
        // 1. Verify domain table
        const domainRow = sqliteDb.prepare(`SELECT * FROM stays WHERE id = ?`).get(stay.id) as any;
        expect(domainRow).toBeDefined();
        const parsed = JSON.parse(domainRow.json_data);
        expect(parsed.plate).toBe('SQL-456');

        // 2. Verify outbox table (Atomic write)
        const outboxRow = sqliteDb.prepare(`SELECT * FROM outbox_events WHERE entity_id = ? AND entity_type = 'Stay'`).get(stay.id) as any;
        expect(outboxRow).toBeDefined();
        expect(outboxRow.operation).toBe('CREATE');
        expect(outboxRow.status).toBe('PENDING');
        
        // 3. Verify it was correctly parsed as JSON inside outbox
        const outboxPayload = JSON.parse(outboxRow.payload);
        expect(outboxPayload.plate).toBe('SQL-456');
    });

    it('TEST B4: Queries nativas (findByPlateOrTicket) en SQLite', async () => {
        StorageEngine.setEngine('SQLITE');
        
        const repo = new StayRepository();
        await repo.save({ plate: 'ABC-111', ticket_code: 'TCK999', entryTime: new Date(), active: true } as any);
        
        const found = await repo.findActiveByPlateOrTicket('TCK999');
        expect(found).toBeDefined();
        expect(found?.plate).toBe('ABC-111');
        
        const foundPlate = await repo.findActiveByPlateOrTicket('ABC-111');
        expect(foundPlate).toBeDefined();
        expect(foundPlate?.ticket_code).toBe('TCK999');
    });

    it('TEST B5: ConfigRepository fallbacks (Read-Only)', async () => {
        StorageEngine.setEngine('SQLITE');
        // ConfigRepository
        const { ConfigRepository } = await import('../src/modules/Configuration/infra/ConfigRepository');
        const repo = new ConfigRepository();
        
        // Should fetch empty arrays safely or fallback to cloud which errors elegantly
        const prices = await repo.getPrices('garage_1');
        expect(prices).toBeDefined();
        expect(Array.isArray(prices)).toBe(true);
    });

    it('TEST B6: MovementRepository proxy check', async () => {
        StorageEngine.setEngine('SQLITE');
        const repo = new MovementRepository();
        
        const mov = await repo.save({
            type: 'INGRESO', timestamp: new Date(), amount: 1000, paymentMethod: 'Efectivo', shiftId: 'shift_1'
        } as any);

        const found = await repo.findByShiftId('shift_1');
        expect(found.length).toBeGreaterThan(0);
        expect(found[0].amount).toBe(1000);
    });
});
