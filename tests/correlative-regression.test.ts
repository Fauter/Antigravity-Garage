import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CorrelativeService, CorrelativeError } from '../src/shared/CorrelativeService';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../src/infrastructure/lib/supabase';

vi.mock('../src/infrastructure/lib/supabase');

describe('CorrelativeService - High Water Regression Prevention', () => {
    let db: any;
    const garageId = 'test-garage';

    beforeEach(() => {
        let currentLease = { last_issued: 0, active_end: 0, active_start: 0, pending_request_id: null };

        db = {
            prepare: vi.fn(),
            exec: vi.fn()
        };
        
        db.prepare.mockImplementation((query: string) => ({
            run: (...args: any[]) => {
                if (query.includes('UPDATE correlative_leases') && query.includes('active_start = ?')) {
                    // Update current lease with startVal, endVal, lastIssued
                    currentLease.active_start = args[0];
                    currentLease.active_end = args[1];
                    currentLease.last_issued = args[2];
                    currentLease.pending_request_id = null;
                }
            },
            get: () => {
                if (query.includes('FROM correlative_leases')) {
                    return currentLease;
                }
                if (query.includes('RETURNING')) {
                    // Mock _consumeLocal returning next
                    currentLease.last_issued++;
                    return { last_issued: currentLease.last_issued, active_end: currentLease.active_end, active_start: currentLease.active_start };
                }
                return { c: 1 };
            },
            all: () => {
                if (query.includes('FROM stays')) {
                    return [{ t: 'E0001792' }];
                }
                if (query.includes('FROM movements')) {
                    return [];
                }
                if (query.includes('PRAGMA table_info')) {
                    return [{ name: 'active_start' }];
                }
                return [];
            }
        }));

        vi.spyOn(SQLiteManager, 'getInstance').mockReturnValue({
            getDatabase: () => db
        } as any);

        // We bypass actual schema creation and just let the mock handle it
    });

    it('determines high water mark correctly from local history', () => {
        // Local history has E0001792
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('1', '{"garageId":"test-garage","ticketCode":"E0001792"}')`).run();
        
        const hw = CorrelativeService.determineCorrelativeHighWater(garageId, 'stay', db);
        expect(hw).toBe(1792);
    });

    it('rejects remote blocks that are behind local high water', async () => {
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('1', '{"garageId":"test-garage","ticketCode":"E0001792"}')`).run();
        
        // Mock supabase to return a block that is BEHIND (1545)
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: { start_val: 1545, end_val: 1594, idempotent: false },
            error: null
        } as any);

        await expect(CorrelativeService.ensureStayLeaseAvailable(garageId))
            .rejects
            .toThrowError(/Inconsistencia crítica: El servidor devolvió un bloque.*atrasado/);
    });

    it('repairs the remote server automatically using v3 RPC with min_value', async () => {
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('1', '{"garageId":"test-garage","ticketCode":"E0001792"}')`).run();
        
        // Mock supabase v3 to behave correctly by accepting min_value
        vi.mocked(supabase.rpc).mockImplementation(async (rpcName, args: any) => {
            if (rpcName === 'allocate_ticket_block_v3') {
                const start = Math.max(args.p_min_value, 1544) + 1;
                return {
                    data: { start_val: start, end_val: start + args.p_size - 1, idempotent: false },
                    error: null
                };
            }
            return { error: { message: 'Not found' } };
        });

        await CorrelativeService.ensureStayLeaseAvailable(garageId);
        
        const ticket = CorrelativeService.consumeStayTicketLocal(garageId, db);
        expect(ticket).toBe('E0001793'); // Never emits 1545!
    });
});
