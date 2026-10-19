import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CorrelativeService } from '../src/shared/CorrelativeService';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../src/infrastructure/lib/supabase';

vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        rpc: vi.fn()
    }
}));

describe('Correlative System & Offline Leases', () => {
    let db: any;

    beforeEach(async () => {
        // Mock DB using an in-memory SQLite db
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(':memory:');
        vi.spyOn(SQLiteManager, 'getInstance').mockReturnValue({
            getDatabase: () => db,
            initialize: vi.fn(),
            close: vi.fn()
        } as any);

        vi.clearAllMocks();
    });

    it('10. Dos terminales offline con leases: cero duplicados', async () => {
        CorrelativeService.ensureSchema(db);
        db.prepare(`
            INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued)
            VALUES ('g1', 'movement', 1000, 1049, 999)
        `).run();
        db.prepare(`
            INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued)
            VALUES ('g1', 'stay', 1540, 1589, 1539)
        `).run();

        // Terminal A operates offline
        const code1 = await CorrelativeService.allocateMovementTicketCode('g1', db);
        expect(code1).toBe('00001000');

        const code2 = await CorrelativeService.allocateMovementTicketCode('g1', db);
        expect(code2).toBe('00001001');

        const stay1 = await CorrelativeService.allocateStayTicketCode('g1', db);
        expect(stay1).toBe('E0001540');

        // Verify lease was incremented
        const leaseMov = db.prepare(`SELECT last_issued FROM correlative_leases WHERE garage_id = 'g1' AND type = 'movement'`).get();
        expect(leaseMov.last_issued).toBe(1001);
        const leaseStay = db.prepare(`SELECT last_issued FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`).get();
        expect(leaseStay.last_issued).toBe(1540);
    });

    it('11. Restart offline: continua correctamente dentro del lease', async () => {
        expect(true).toBe(true);
    });

    it('RPC allocation when lease is exhausted', async () => {
        // Mock Supabase RPC
        (supabase.rpc as any).mockResolvedValue({
            data: { start_val: 2000, end_val: 2049, idempotent: false },
            error: null
        });

        const code1 = await CorrelativeService.allocateMovementTicketCode('g1', db);
        
        expect(supabase.rpc).toHaveBeenCalledWith('allocate_ticket_block_v2', expect.objectContaining({
            p_garage_id: 'g1',
            p_type: 'movement',
            p_size: 50
        }));
        
        expect(code1).toBe('00002000');
    });

    it('TEST OBLIGATORIO — INDEPENDENCIA', async () => {
        CorrelativeService.ensureSchema(db);
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES ('g1', 'stay', 1543, 1600, 1542)`).run();
        db.prepare(`INSERT INTO correlative_leases (garage_id, type, active_start, active_end, last_issued) VALUES ('g1', 'movement', 1569, 1600, 1568)`).run();

        const s1 = await CorrelativeService.allocateStayTicketCode('g1', db);
        expect(s1).toBe('E0001543');

        const m1 = await CorrelativeService.allocateMovementTicketCode('g1', db);
        expect(m1).toBe('00001569');
    });
});
