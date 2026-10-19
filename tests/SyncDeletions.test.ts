import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { supabase } from '../src/infrastructure/lib/supabase';

vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        from: vi.fn(),
        channel: vi.fn(),
        removeChannel: vi.fn(),
    }
}));

describe('Offline-First Sync Deletions', () => {
    let db: any;
    let syncCoordinator: SqliteSyncCoordinator;

    beforeEach(() => {
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(':memory:');
        
        // Mock SQLiteManager
        vi.spyOn(SQLiteManager, 'getInstance').mockReturnValue({
            getDatabase: () => db,
            initialize: vi.fn(),
            close: vi.fn()
        } as any);

        // Setup base schema
        db.exec(`
            CREATE TABLE garages (id TEXT PRIMARY KEY, json_data TEXT);
            CREATE TABLE stays (id TEXT PRIMARY KEY, json_data TEXT);
            CREATE TABLE movements (id TEXT PRIMARY KEY, json_data TEXT);
            CREATE TABLE outbox_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id TEXT, status TEXT, payload TEXT);
            CREATE TABLE sync_checkpoints (collection_name TEXT PRIMARY KEY, last_synced_at TEXT);
        `);
        
        db.prepare(`INSERT INTO garages (id, json_data) VALUES ('g1', '{"id": "g1", "ownerId": "owner-1"}')`).run();

        syncCoordinator = new SqliteSyncCoordinator();
        vi.clearAllMocks();
    });

    it('TEST 2 — DELETE CON PC APAGADA (Reconciliación Autoritativa)', async () => {
        // Setup local stays: one valid, one zombie
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('valid-1', '{"garageId": "g1", "id": "valid-1"}')`).run();
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('zombie-1', '{"garageId": "g1", "id": "zombie-1"}')`).run();
        
        // Mock supabase calls for runSyncCycle
        const mockSupabaseQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockImplementation((from, to) => {
                // Return only valid-1 for stays id reconciliation
                if (from === 0) {
                    return Promise.resolve({ data: [{ id: 'valid-1' }], error: null });
                }
                return Promise.resolve({ data: [], error: null });
            })
        };
        (supabase.from as any).mockReturnValue(mockSupabaseQuery);

        await syncCoordinator.runSyncCycle('g1', 'MANUAL_BOOTSTRAP');

        // Zombie should be deleted
        const remainingStays = db.prepare(`SELECT * FROM stays`).all();
        expect(remainingStays.length).toBe(1);
        expect(remainingStays[0].id).toBe('valid-1');
    });

    it('TEST 3 — MUTACIÓN LOCAL PENDIENTE', async () => {
        // Setup local stays: one valid, one zombie WITH pending mutation
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('valid-1', '{"garageId": "g1", "id": "valid-1"}')`).run();
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('zombie-with-mutation', '{"garageId": "g1", "id": "zombie-with-mutation"}')`).run();
        
        // Add pending mutation
        db.prepare(`INSERT INTO outbox_events (entity_type, entity_id, status) VALUES ('Stay', 'zombie-with-mutation', 'PENDING')`).run();
        
        // Mock supabase calls
        const mockSupabaseQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockImplementation((from, to) => {
                if (from === 0) {
                    return Promise.resolve({ data: [{ id: 'valid-1' }], error: null });
                }
                return Promise.resolve({ data: [], error: null });
            })
        };
        (supabase.from as any).mockReturnValue(mockSupabaseQuery);

        // Outbox push mock
        const mockUpsert = { upsert: vi.fn().mockResolvedValue({ error: null }) };
        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'stays') return mockUpsert;
            return mockSupabaseQuery;
        });

        await syncCoordinator.runSyncCycle('g1', 'MANUAL_BOOTSTRAP');

        // Zombie WITH mutation should SURVIVE the reconciliation
        const remainingStays = db.prepare(`SELECT * FROM stays ORDER BY id`).all();
        expect(remainingStays.length).toBe(2);
    });

    it('TEST 1 — DELETE ONLINE (Realtime)', () => {
        db.prepare(`INSERT INTO stays (id, json_data) VALUES ('stay-to-delete', '{"garageId": "g1", "id": "stay-to-delete"}')`).run();
        
        // Emulate Realtime payload
        (syncCoordinator as any).handleRealtimePayload({
            table: 'stays',
            eventType: 'DELETE',
            old: { id: 'stay-to-delete' }
        }, 'g1');

        const remainingStays = db.prepare(`SELECT * FROM stays`).all();
        expect(remainingStays.length).toBe(0);
    });
});
