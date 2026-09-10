import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../src/infrastructure/lib/supabase';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';

// Mock StorageEngine to always return SQLITE
vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');

// Mock Supabase
vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
            delete: vi.fn().mockResolvedValue({ data: null, error: null }),
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
            })
        })),
        rpc: vi.fn(),
        channel: vi.fn(() => ({
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn().mockReturnThis()
        }))
    }
}));

describe('Offline-First Sync End-to-End Audit (SQLite)', () => {
    let coordinator: SqliteSyncCoordinator;
    let db: any;

    beforeEach(() => {
        // We ensure test DB is isolated
        process.env.NODE_ENV = 'test';
        db = SQLiteManager.getInstance().getDatabase();
        // Clear tables
        db.prepare('DELETE FROM outbox_events').run();
        db.prepare('DELETE FROM customers').run();
        vi.clearAllMocks();
        coordinator = new SqliteSyncCoordinator();
    });

    it('T1 local write generates outbox (mocked via insert)', () => {
        db.prepare(`INSERT INTO outbox_events (event_id, sequence, entity_type, entity_id, operation, payload, status, created_at, updated_at) VALUES ('e1', 1, 'Customer', 'c1', 'CREATE', '{}', 'PENDING', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`).run();
        const cnt = db.prepare(`SELECT count(*) as c FROM outbox_events`).get();
        expect(cnt.c).toBe(1);
    });

    it('T2 push remoto simulado -> ACK', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, sequence, entity_type, entity_id, operation, payload, status, created_at, updated_at) VALUES ('e2', 1, 'Customer', 'c1', 'CREATE', '{}', 'PENDING', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`).run();
        await coordinator.processOutbox();
        const event = db.prepare(`SELECT status FROM outbox_events WHERE sequence = 1`).get();
        expect(event.status).toBe('ACKED');
    });

    it('T3 network failure -> RETRY, nunca BLOCKED', async () => {
        vi.mocked(supabase.from).mockReturnValueOnce({
            upsert: vi.fn().mockRejectedValue(new Error('fetch failed')),
            delete: vi.fn(),
            select: vi.fn()
        } as any);

        db.prepare(`INSERT INTO outbox_events (event_id, sequence, entity_type, entity_id, operation, payload, status, created_at, updated_at) VALUES ('e3', 1, 'Customer', 'c1', 'CREATE', '{}', 'PENDING', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`).run();
        await coordinator.processOutbox();
        const event = db.prepare(`SELECT status, attempts FROM outbox_events WHERE sequence = 1`).get();
        expect(event.status).toBe('RETRY');
        expect(event.attempts).toBe(1);
    });

    it('T14 permanent event BLOCKED no condena independientes', async () => {
        vi.mocked(supabase.from).mockReturnValueOnce({
            upsert: vi.fn().mockRejectedValue({ code: '23505', message: 'Unique violation' }), // Permanent
            delete: vi.fn(),
            select: vi.fn()
        } as any).mockReturnValueOnce({
            upsert: vi.fn().mockResolvedValue({ data: null, error: null }), // Success for second
            delete: vi.fn(),
            select: vi.fn()
        } as any);

        db.prepare(`INSERT INTO outbox_events (event_id, sequence, entity_type, entity_id, operation, payload, status, created_at, updated_at) VALUES ('e4', 1, 'Customer', 'c1', 'CREATE', '{}', 'PENDING', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`).run();
        db.prepare(`INSERT INTO outbox_events (event_id, sequence, entity_type, entity_id, operation, payload, status, created_at, updated_at) VALUES ('e5', 2, 'Customer', 'c2', 'CREATE', '{}', 'PENDING', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`).run();
        
        await coordinator.processOutbox();
        
        const ev1 = db.prepare(`SELECT status FROM outbox_events WHERE sequence = 1`).get();
        const ev2 = db.prepare(`SELECT status FROM outbox_events WHERE sequence = 2`).get();
        
        expect(ev1.status).toBe('BLOCKED');
        expect(ev2.status).toBe('ACKED'); // It should drain FIFO independently
    });
});
