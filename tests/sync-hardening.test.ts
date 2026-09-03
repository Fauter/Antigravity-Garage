import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';

vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            upsert: vi.fn(),
            delete: vi.fn(),
            select: vi.fn(() => ({ eq: vi.fn() }))
        })),
        channel: vi.fn(() => ({
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn()
        }))
    }
}));

describe('Offline-First Sync Hardening', () => {
    let coord: any;
    let db: any;

    beforeAll(() => {
        SQLiteManager.getInstance().getDatabase();
        db = SQLiteManager.getInstance().getDatabase();
        coord = new SqliteSyncCoordinator();
    });

    afterEach(() => {
        db.prepare('DELETE FROM outbox_events').run();
        db.prepare('DELETE FROM customers').run();
    });

    it('GATE A/B: 24h/72h Offline Resistance & Network Errors', async () => {
        // Insert a pending event
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
                    VALUES ('e1', 'Customer', 'c1', 'CREATE', '{}', 'PENDING', ?, ?, 100, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        // Mock a network error
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        (supabase.from as any).mockImplementationOnce(() => ({
            upsert: vi.fn().mockRejectedValue({ code: 'ECONNREFUSED', message: 'connection refused' })
        }));

        await coord.processOutbox();

        const row = db.prepare('SELECT status, attempts, last_error FROM outbox_events WHERE sequence = 100').get();
        expect(row.status).toBe('RETRY');
        expect(row.attempts).toBe(1);
        expect(coord.backendReachable).toBe(false);

        // Even after many attempts, it should not be BLOCKED for network errors
        db.prepare(`UPDATE outbox_events SET attempts = 15, last_attempt_at = ? WHERE sequence = 100`).run(new Date(Date.now() - 600000).toISOString());
        
        (supabase.from as any).mockImplementationOnce(() => ({
            upsert: vi.fn().mockRejectedValue({ code: 'ETIMEDOUT', message: 'timeout' })
        }));
        await coord.processOutbox();

        const row2 = db.prepare('SELECT status, attempts FROM outbox_events WHERE sequence = 100').get();
        expect(row2.status).toBe('RETRY'); // Never BLOCKED
        expect(row2.attempts).toBe(16);
    });

    it('GATE F: Dirty Local Protection (Realtime / Pull)', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e2', 'Customer', 'c2', 'UPDATE', '{}', 'PENDING', ?, ?, 101, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        // Try to apply remote row
        let txRun = false;
        const mockTx = {
            prepare: (sql: string) => ({
                get: (...args: any[]) => {
                    if (sql.includes('count(*)')) return { count: 1 }; // Dirty
                    return null;
                },
                run: () => { txRun = true; }
            })
        };

        coord.applyRemoteRow(mockTx, { id: 'c2', name: 'Remote' }, 'customers', 'customers', 'Customer', 'garage1');
        
        expect(txRun).toBe(false); // Should not overwrite
    });

    it('GATE C: Auto Reconnect & Recovery', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e3', 'Customer', 'c3', 'CREATE', '{}', 'RETRY', ?, ?, 102, 0)`).run(new Date(Date.now() - 500000).toISOString(), new Date().toISOString());
        
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        (supabase.from as any).mockImplementationOnce(() => ({
            upsert: vi.fn().mockResolvedValue({ error: null })
        }));

        coord.backendReachable = true;
        coord.justReconnected = true; // Simulating fast path

        await coord.processOutbox();

        const row = db.prepare('SELECT status FROM outbox_events WHERE sequence = 102').get();
        expect(row.status).toBe('ACKED');
    });

    it('GATE H: Bad event does not block independents', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e4', 'Customer', 'c4', 'CREATE', '{}', 'PENDING', ?, ?, 103, 0)`).run(new Date().toISOString(), new Date().toISOString());
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e5', 'Customer', 'c5', 'CREATE', '{}', 'PENDING', ?, ?, 104, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        let calls = 0;
        (supabase.from as any).mockImplementation(() => ({
            upsert: vi.fn().mockImplementation(() => {
                calls++;
                if (calls === 1) return Promise.reject({ status: 400 }); // Permanent
                return Promise.resolve({ error: null }); // Success
            })
        }));

        await coord.processOutbox();

        const r1 = db.prepare('SELECT status FROM outbox_events WHERE sequence = 103').get();
        const r2 = db.prepare('SELECT status FROM outbox_events WHERE sequence = 104').get();
        
        expect(r1.status).toBe('BLOCKED');
        expect(r2.status).toBe('ACKED'); // It continued!
    });

    it('GATE G: Crash during PROCESSING recovery', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e6', 'Customer', 'c6', 'CREATE', '{}', 'PROCESSING', ?, ?, 105, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        // Simulating restart
        const newCoord = new SqliteSyncCoordinator(); 
        
        const row = db.prepare('SELECT status FROM outbox_events WHERE sequence = 105').get();
        expect(row.status).toBe('PENDING'); // Recovered!
    });
});
