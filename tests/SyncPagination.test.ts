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

describe('Offline-First Sync Pagination & Reconcile Abort', () => {
    let db: any;
    let syncCoordinator: SqliteSyncCoordinator;

    beforeEach(() => {
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(':memory:');
        
        vi.spyOn(SQLiteManager, 'getInstance').mockReturnValue({
            getDatabase: () => db,
            initialize: vi.fn(),
            close: vi.fn()
        } as any);

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

    const setupLocalStays = (count: number) => {
        const stmt = db.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`);
        for (let i = 1; i <= count; i++) {
            stmt.run(`stay-${i}`, JSON.stringify({ garageId: 'g1', id: `stay-${i}` }));
        }
    };

    const mockSupabaseRange = (totalRemote: number, shouldFailOnPage: number = -1) => {
        let currentPage = 1;
        const mockSupabaseQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockImplementation((from, to) => {
                // If it's a pull for data (not ID reconciliation), return empty to skip to reconciliation fast
                if (mockSupabaseQuery.select.mock.calls.length > 0 && mockSupabaseQuery.select.mock.calls[mockSupabaseQuery.select.mock.calls.length-1][0] === '*') {
                     return Promise.resolve({ data: [], error: null });
                }

                if (currentPage === shouldFailOnPage) {
                    return Promise.resolve({ data: null, error: { message: 'Network Timeout 504' } });
                }
                
                const pageSize = 1000;
                const remaining = totalRemote - from;
                const returnCount = Math.max(0, Math.min(pageSize, remaining));
                
                const data = [];
                for (let i = 1; i <= returnCount; i++) {
                    // For test 8, say we omit stay-2500 so totalRemote is 2499 and stay-2500 is deleted
                    data.push({ id: `stay-${from + i}` });
                }
                
                currentPage++;
                return Promise.resolve({ data, error: null });
            })
        };
        (supabase.from as any).mockReturnValue(mockSupabaseQuery);
    };

    it('Test crítico: 2500 remotas vs 2500 locales (0 deletes)', async () => {
        setupLocalStays(2500);
        mockSupabaseRange(2500);

        await syncCoordinator.runSyncCycle('g1', 'MANUAL_BOOTSTRAP');

        const remainingStays = db.prepare(`SELECT count(*) as c FROM stays`).get() as any;
        expect(remainingStays.c).toBe(2500);
    });

    it('Otro test: 2499 remotas vs 2500 locales (1 delete exacto)', async () => {
        setupLocalStays(2500);
        mockSupabaseRange(2499); // Simulates remote returning up to 2499

        await syncCoordinator.runSyncCycle('g1', 'MANUAL_BOOTSTRAP');

        const remainingStays = db.prepare(`SELECT count(*) as c FROM stays`).get() as any;
        expect(remainingStays.c).toBe(2499);
        
        // Ensure the exact deleted one is stay-2500
        const zombieCheck = db.prepare(`SELECT count(*) as c FROM stays WHERE id = 'stay-2500'`).get() as any;
        expect(zombieCheck.c).toBe(0);
    });

    it('Confirmar que si falla la página 2, NO se elimina ninguna fila local', async () => {
        setupLocalStays(2500);
        // We have 2500 remote, but page 2 will throw a network error
        mockSupabaseRange(2500, 2);

        await syncCoordinator.runSyncCycle('g1', 'MANUAL_BOOTSTRAP');

        // ABORTED completely. Local database remains exactly at 2500.
        const remainingStays = db.prepare(`SELECT count(*) as c FROM stays`).get() as any;
        expect(remainingStays.c).toBe(2500);
    });

    it('Probar límites exactos', async () => {
        const testLimits = [500, 1000, 1001, 5500];
        
        for (const limit of testLimits) {
            db.exec('DELETE FROM stays');
            setupLocalStays(limit);
            mockSupabaseRange(limit);
            
            await syncCoordinator.runSyncCycle('g1', 'MANUAL_BOOTSTRAP');
            
            const remaining = db.prepare(`SELECT count(*) as c FROM stays`).get() as any;
            expect(remaining.c).toBe(limit);
        }
    });

    it('OwnerId inexistente aborta y elimina 0 locales', async () => {
        setupLocalStays(100);
        mockSupabaseRange(100);
        
        // Remove ownerId to trigger error
        db.prepare(`UPDATE garages SET json_data = '{"id": "g1"}' WHERE id = 'g1'`).run();
        
        // Force the stays mapping to use owner_lookup to test the fail-safe
        const originalMappings = SqliteSyncCoordinator.tableMappings;
        SqliteSyncCoordinator.tableMappings = [{
            remoteTable: 'stays',
            localTable: 'stays',
            entityType: 'Stay',
            filterStrategy: 'owner_lookup'
        }];

        await syncCoordinator.runSyncCycle('g1', 'MANUAL_BOOTSTRAP');
        
        const remainingStays = db.prepare(`SELECT count(*) as c FROM stays`).get() as any;
        expect(remainingStays.c).toBe(100); // Aborted safely, 0 deletes
        
        // Restore mapping
        SqliteSyncCoordinator.tableMappings = originalMappings;
    });
});
