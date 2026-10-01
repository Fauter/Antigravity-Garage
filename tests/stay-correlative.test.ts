import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { CorrelativeService } from '../src/shared/CorrelativeService';
import { supabase } from '../src/infrastructure/lib/supabase';

vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        rpc: vi.fn()
    }
}));

describe('Stay Correlative Generator (SQLite Atomic)', () => {
    let db: any;
    const garageA = 'garage-A';
    const garageB = 'garage-B';

    beforeAll(async () => {
        StorageEngine.setEngine('SQLITE');
        db = SQLiteManager.getInstance().getDatabase();
    });

    beforeEach(() => {
        // Clear tables for a clean slate
        db.exec(`DROP TABLE IF EXISTS correlative_leases;`);
        CorrelativeService.ensureSchema(db);
        db.exec(`CREATE TABLE IF NOT EXISTS stays (id TEXT PRIMARY KEY, json_data TEXT);`);
        db.exec(`CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, json_data TEXT);`);
        db.exec(`DELETE FROM stays;`);
        db.exec(`DELETE FROM movements;`);
        vi.clearAllMocks();
    });

    it('T1: existing max E0000094 -> next E0000095 (via reconcile)', async () => {
        db.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run(
            'stay1', JSON.stringify({ garageId: garageA, ticketCode: 'E0000094' })
        );

        await CorrelativeService.reconcileForGarage(garageA);

        // Next alloc will call RPC because active_end = 0. We mock it.
        (supabase.rpc as any).mockResolvedValue({ data: { start_val: 100, end_val: 150 }, error: null });

        const next = await CorrelativeService.allocateStayTicketCode(garageA, db);
        // Because of the bug fix, it MUST jump to start_val, NOT last_issued+1!
        expect(next).toBe('E0000100');
    });

    it('T3: restart -> continues from last_issued in leases', async () => {
        CorrelativeService.ensureSchema(db);
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES (?, ?, ?, ?, ?)`).run(garageA, 'stay', 1, 100, 96);
        const next = await CorrelativeService.allocateStayTicketCode(garageA, db);
        expect(next).toBe('E0000097');
    });

    it('T4: garage isolation', async () => {
        CorrelativeService.ensureSchema(db);
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES (?, ?, ?, ?, ?)`).run(garageA, 'stay', 1, 100, 94);
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES (?, ?, ?, ?, ?)`).run(garageB, 'stay', 4500, 4600, 4564);

        const nextA = await CorrelativeService.allocateStayTicketCode(garageA, db);
        const nextB = await CorrelativeService.allocateStayTicketCode(garageB, db);

        expect(nextA).toBe('E0000095');
        expect(nextB).toBe('E0004565');
    });

    it('T6: offline allocation works via SQLite', async () => {
        CorrelativeService.ensureSchema(db);
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES (?, ?, ?, ?, ?)`).run(garageA, 'stay', 1, 100, 0);
        
        const t1 = await CorrelativeService.allocateStayTicketCode(garageA, db);
        const t2 = await CorrelativeService.allocateStayTicketCode(garageA, db);
        expect(t1).toBe('E0000001');
        expect(t2).toBe('E0000002');
    });

    it('T10: prepaid: Stay code != Movement code, both valid and independent', async () => {
        CorrelativeService.ensureSchema(db);
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES (?, ?, ?, ?, ?)`).run(garageA, 'stay', 1, 100, 96);
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES (?, ?, ?, ?, ?)`).run(garageA, 'movement', 100, 200, 120);

        const stayTicket = await CorrelativeService.allocateStayTicketCode(garageA, db);
        const movTicket = await CorrelativeService.allocateMovementTicketCode(garageA, db);

        expect(stayTicket).toBe('E0000097');
        expect(movTicket).toBe('00000121');
    });
});
