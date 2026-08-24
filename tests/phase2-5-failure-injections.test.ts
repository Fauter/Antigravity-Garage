import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { StayRepository } from '../src/modules/AccessControl/infra/StayRepository';
import { BaseSqliteRepository } from '../src/infrastructure/database/sqlite/BaseSqliteRepository';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../src/infrastructure/database/datastore';

describe('PHASE 2.5 - Failure Injections', () => {

    beforeAll(() => {
        StorageEngine.setEngine('SQLITE');
        SQLiteManager.resetInstance();
        
        // Ensure a clean database for these tests
        const dbPath = path.join(DATA_DIR, 'garageia.sqlite');
        try { fs.unlinkSync(dbPath); } catch (e) {}
    });

    afterAll(() => {
        StorageEngine.setEngine('NEDB');
        SQLiteManager.resetInstance();
        vi.restoreAllMocks();
    });

    it('TEST 10: CREATE Failure Injection (Outbox Insert fails)', async () => {
        const repo = new StayRepository();
        
        // We will mock the BaseSqliteRepository's insertOutboxEvent to throw an error
        const insertOutboxSpy = vi.spyOn(BaseSqliteRepository.prototype as any, 'insertOutboxEvent').mockImplementation(() => {
            throw new Error('SIMULATED_OUTBOX_FAILURE');
        });

        const newStay = { plate: 'FAIL-001', entryTime: new Date() } as any;

        let threw = false;
        try {
            await repo.save(newStay);
        } catch (e: any) {
            threw = true;
            expect(e.message).toBe('SIMULATED_OUTBOX_FAILURE');
        }

        expect(threw).toBe(true);

        // Assert domain row does NOT exist
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT * FROM stays WHERE json_extract(json_data, '$.plate') = ?`).all('FAIL-001');
        expect(rows.length).toBe(0); // Should be rolled back!

        // Assert outbox row does NOT exist
        const outboxRows = db.prepare(`SELECT * FROM outbox_events`).all();
        expect(outboxRows.length).toBe(0);

        insertOutboxSpy.mockRestore();
    });

    it('TEST 11: UPDATE Failure Injection', async () => {
        const repo = new StayRepository();
        
        // Save first successfully
        const newStay = { plate: 'UPD-001', entryTime: new Date() } as any;
        const saved = await repo.save(newStay);
        
        // Now mock Outbox to fail
        const insertOutboxSpy = vi.spyOn(BaseSqliteRepository.prototype as any, 'insertOutboxEvent').mockImplementation(() => {
            throw new Error('SIMULATED_OUTBOX_FAILURE_UPDATE');
        });

        const stayId = saved.id;
        saved.plate = 'UPD-001-MODIFIED';

        let threw = false;
        try {
            await repo.save(saved);
        } catch (e: any) {
            threw = true;
            expect(e.message).toBe('SIMULATED_OUTBOX_FAILURE_UPDATE');
        }

        expect(threw).toBe(true);

        // Assert domain row is STILL original
        const db = SQLiteManager.getInstance().getDatabase();
        const row = db.prepare(`SELECT * FROM stays WHERE id = ?`).get(stayId) as any;
        const parsed = JSON.parse(row.json_data);
        expect(parsed.plate).toBe('UPD-001'); // Not MODIFIED

        insertOutboxSpy.mockRestore();
    });

    it('TEST 12: DELETE Failure Injection', async () => {
        const repo = new StayRepository();
        
        // Save first successfully
        const newStay = { plate: 'DEL-001', entryTime: new Date() } as any;
        const saved = await repo.save(newStay);
        
        // Now mock Outbox to fail
        const insertOutboxSpy = vi.spyOn(BaseSqliteRepository.prototype as any, 'insertOutboxEvent').mockImplementation(() => {
            throw new Error('SIMULATED_OUTBOX_FAILURE_DELETE');
        });

        const stayId = saved.id;

        let threw = false;
        try {
            await (repo as any).impl.delete(stayId); 
        } catch (e: any) {
            threw = true;
            expect(e.message).toBe('SIMULATED_OUTBOX_FAILURE_DELETE');
        }

        expect(threw).toBe(true);

        // Assert domain row STILL exists
        const db = SQLiteManager.getInstance().getDatabase();
        const row = db.prepare(`SELECT * FROM stays WHERE id = ?`).get(stayId) as any;
        expect(row).toBeDefined();

        insertOutboxSpy.mockRestore();
    });
});
