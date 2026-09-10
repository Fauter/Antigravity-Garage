import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
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
        })),
        removeChannel: vi.fn()
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
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
                    VALUES ('e1', 'Customer', 'c1', 'CREATE', '{}', 'PENDING', ?, ?, 100, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        (supabase.from as any).mockImplementationOnce(() => ({
            upsert: vi.fn().mockRejectedValue({ code: 'ECONNREFUSED', message: 'connection refused' })
        }));

        await coord.processOutbox();

        const row = db.prepare('SELECT status, attempts, last_error FROM outbox_events WHERE sequence = 100').get();
        expect(row.status).toBe('RETRY');
        expect(row.attempts).toBe(1);
        expect(coord.backendReachable).toBe(false);

        db.prepare(`UPDATE outbox_events SET attempts = 15, last_attempt_at = ? WHERE sequence = 100`).run(new Date(Date.now() - 600000).toISOString());
        
        (supabase.from as any).mockImplementationOnce(() => ({
            upsert: vi.fn().mockRejectedValue({ code: 'ETIMEDOUT', message: 'timeout' })
        }));
        await coord.processOutbox();

        const row2 = db.prepare('SELECT status, attempts FROM outbox_events WHERE sequence = 100').get();
        expect(row2.status).toBe('RETRY');
        expect(row2.attempts).toBe(16);
    });

    it('GATE F: Dirty Local Protection (Realtime / Pull)', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e2', 'Customer', 'c2', 'UPDATE', '{}', 'PENDING', ?, ?, 101, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        let txRun = false;
        const mockTx = {
            prepare: (sql: string) => ({
                get: (...args: any[]) => {
                    if (sql.includes('count(*)')) return { count: 1 };
                    return null;
                },
                run: () => { txRun = true; }
            })
        };

        coord.applyRemoteRow(mockTx, { id: 'c2', name: 'Remote' }, 'customers', 'customers', 'Customer', 'garage1');
        expect(txRun).toBe(false);
    });

    it('GATE C: Auto Reconnect & Recovery', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e3', 'Customer', 'c3', 'CREATE', '{}', 'RETRY', ?, ?, 102, 0)`).run(new Date(Date.now() - 500000).toISOString(), new Date().toISOString());
        
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        (supabase.from as any).mockImplementationOnce(() => ({
            upsert: vi.fn().mockResolvedValue({ error: null })
        }));

        coord.backendReachable = true;
        coord.justReconnected = true;

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
                if (calls === 1) return Promise.reject({ status: 400 });
                return Promise.resolve({ error: null });
            })
        }));

        await coord.processOutbox();

        const r1 = db.prepare('SELECT status FROM outbox_events WHERE sequence = 103').get();
        const r2 = db.prepare('SELECT status FROM outbox_events WHERE sequence = 104').get();
        
        expect(r1.status).toBe('BLOCKED');
        expect(r2.status).toBe('ACKED');
    });

    it('GATE G: Crash during PROCESSING recovery', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e6', 'Customer', 'c6', 'CREATE', '{}', 'PROCESSING', ?, ?, 105, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        const newCoord = new SqliteSyncCoordinator(); 
        
        const row = db.prepare('SELECT status FROM outbox_events WHERE sequence = 105').get();
        expect(row.status).toBe('PENDING');
    });
});

describe('Garage Switch Hardening (BUG-1)', () => {
    let db: any;

    beforeEach(() => {
        db = SQLiteManager.getInstance().getDatabase();
    });

    it('T1: periodic creates exactly one timer per garage', () => {
        const coord = new SqliteSyncCoordinator();
        coord.startReconciliation('garage-A');
        expect(coord['reconciliationInterval']).not.toBeNull();
        expect(coord['activeReconciliationGarageId']).toBe('garage-A');

        const firstInterval = coord['reconciliationInterval'];
        coord.startReconciliation('garage-A');
        expect(coord['reconciliationInterval']).toBe(firstInterval);

        coord.stopReconciliation();
    });

    it('T2: garage switch clears old timer and creates new one', () => {
        const coord = new SqliteSyncCoordinator();
        coord.startReconciliation('garage-A');
        const timerA = coord['reconciliationInterval'];
        expect(timerA).not.toBeNull();

        coord.startReconciliation('garage-B');
        const timerB = coord['reconciliationInterval'];
        expect(timerB).not.toBeNull();
        expect(timerB).not.toBe(timerA);
        expect(coord['activeReconciliationGarageId']).toBe('garage-B');

        coord.stopReconciliation();
    });

    it('T3: garage switch cleans up realtime channel', async () => {
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        vi.mocked(supabase.removeChannel).mockClear();
        const coord = new SqliteSyncCoordinator();

        // Simulate active channel for garage-A
        coord['garageId'] = 'garage-A';
        coord['activeRealtimeGarageId'] = 'garage-A';
        coord['realtimeChannel'] = { fake: 'channelA' };

        // Switch to garage B â€” garageId is still A when initRealtime(B) is called
        coord.initRealtime('garage-B');

        expect(supabase.removeChannel).toHaveBeenCalledWith({ fake: 'channelA' });
    });

    it('T4: same garage does not duplicate realtime', async () => {
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        vi.mocked(supabase.removeChannel).mockClear();
        const coord = new SqliteSyncCoordinator();

        coord['garageId'] = 'garage-A';
        coord['activeRealtimeGarageId'] = 'garage-A';
        coord['realtimeChannel'] = { fake: 'channelA' };

        coord.initRealtime('garage-A');
        expect(supabase.removeChannel).not.toHaveBeenCalled();
    });

    it('T18: stopReconciliation is idempotent', () => {
        const coord = new SqliteSyncCoordinator();
        coord.stopReconciliation();
        expect(coord['reconciliationInterval']).toBeNull();
        expect(coord['activeReconciliationGarageId']).toBeNull();

        coord.startReconciliation('garage-X');
        coord.stopReconciliation();
        expect(coord['reconciliationInterval']).toBeNull();
        
        coord.stopReconciliation();
        expect(coord['reconciliationInterval']).toBeNull();
    });
});

describe('PULL Mapping Hardening (BUG-3/4)', () => {
    let db: any;

    beforeEach(() => {
        db = SQLiteManager.getInstance().getDatabase();
        db.prepare('DELETE FROM movements').run();
        db.prepare('DELETE FROM promos').run();
        db.prepare('DELETE FROM garages WHERE 1=1').run();
        db.prepare('DELETE FROM outbox_events').run();
    });

    it('T5: movements exists in tableMappings for PULL', () => {
        const mapping = SqliteSyncCoordinator.tableMappings.find(m => m.remoteTable === 'movements');
        expect(mapping).toBeDefined();
        expect(mapping!.localTable).toBe('movements');
        expect(mapping!.entityType).toBe('Movement');
    });

    it('T6: movements remoteâ†’local applies correctly via applyRemoteRow', () => {
        const coord = new SqliteSyncCoordinator();
        const remoteRow = {
            id: 'mov-001',
            garage_id: 'garage-A',
            amount: 5000,
            type: 'INGRESO',
            updated_at: new Date().toISOString()
        };

        db.exec('BEGIN IMMEDIATE;');
        coord['applyRemoteRow'](db, remoteRow, 'movements', 'movements', 'Movement', 'garage-A');
        db.exec('COMMIT;');

        const local = db.prepare('SELECT json_data FROM movements WHERE id = ?').get('mov-001') as any;
        expect(local).toBeDefined();
        const parsed = JSON.parse(local.json_data);
        expect(parsed.amount).toBe(5000);
        expect(parsed.garageId).toBe('garage-A');
    });

    it('T7: movements idempotent repeated pull', () => {
        const coord = new SqliteSyncCoordinator();
        const remoteRow = {
            id: 'mov-002',
            garage_id: 'garage-A',
            amount: 3000,
            updated_at: new Date().toISOString()
        };

        db.exec('BEGIN IMMEDIATE;');
        coord['applyRemoteRow'](db, remoteRow, 'movements', 'movements', 'Movement', 'garage-A');
        db.exec('COMMIT;');

        db.exec('BEGIN IMMEDIATE;');
        coord['applyRemoteRow'](db, remoteRow, 'movements', 'movements', 'Movement', 'garage-A');
        db.exec('COMMIT;');

        const count = db.prepare('SELECT count(*) as c FROM movements WHERE id = ?').get('mov-002') as any;
        expect(count.c).toBe(1);
    });

    it('T8: financial PULL does not create Outbox events', () => {
        const coord = new SqliteSyncCoordinator();
        const remoteMovement = {
            id: 'mov-003',
            garage_id: 'garage-A',
            amount: 7500,
            updated_at: new Date().toISOString()
        };

        db.exec('BEGIN IMMEDIATE;');
        coord['applyRemoteRow'](db, remoteMovement, 'movements', 'movements', 'Movement', 'garage-A');
        db.exec('COMMIT;');

        const outboxCount = db.prepare(`SELECT count(*) as c FROM outbox_events WHERE entity_type = 'Movement' AND entity_id = 'mov-003'`).get() as any;
        expect(outboxCount.c).toBe(0);
    });

    it('T9: all tableMappings correspond to real local SQLite tables', () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
        for (const mapping of SqliteSyncCoordinator.tableMappings) {
            expect(tables).toContain(mapping.localTable);
        }
    });

    it('T10: promos remoteâ†’local applies correctly', () => {
        const coord = new SqliteSyncCoordinator();
        const remotePromo = {
            id: 'promo-001',
            garage_id: 'garage-A',
            name: '2x1 Navidad',
            discount_pct: 50,
            updated_at: new Date().toISOString()
        };

        db.exec('BEGIN IMMEDIATE;');
        coord['applyRemoteRow'](db, remotePromo, 'promos', 'promos', 'Promo', 'garage-A');
        db.exec('COMMIT;');

        const local = db.prepare('SELECT json_data FROM promos WHERE id = ?').get('promo-001') as any;
        expect(local).toBeDefined();
        const parsed = JSON.parse(local.json_data);
        expect(parsed.name).toBe('2x1 Navidad');
        expect(parsed.discountPct).toBe(50);
    });

    it('T11: smallConfigTables only contains tables in tableMappings', () => {
        const mappedRemoteTables = SqliteSyncCoordinator.tableMappings.map(m => m.remoteTable);
        const smallConfigTables = ['financial_configs', 'vehicle_types', 'tariffs', 'prices', 'promos', 'building_levels', 'employee_accounts', 'garages'];
        for (const table of smallConfigTables) {
            expect(mappedRemoteTables).toContain(table);
        }
    });

    it('T13: prices regression â€” still in tableMappings and config', () => {
        const mapping = SqliteSyncCoordinator.tableMappings.find(m => m.remoteTable === 'prices');
        expect(mapping).toBeDefined();
        expect(mapping!.localTable).toBe('prices');
        expect(mapping!.entityType).toBe('Price');
    });

    it('T14: PUSHâ†’PULL order regression', async () => {
        const coord = new SqliteSyncCoordinator();
        const callOrder: string[] = [];
        
        const origProcessOutbox = coord.processOutbox.bind(coord);
        coord.processOutbox = vi.fn(async () => { callOrder.push('PUSH'); await origProcessOutbox(); });
        coord['fetchTable'] = vi.fn(async (...args: any[]) => { callOrder.push('PULL'); });

        await coord.runSyncCycle('garage-test', 'REGRESSION');

        expect(callOrder[0]).toBe('PUSH');
        expect(callOrder.filter(c => c === 'PULL').length).toBeGreaterThan(0);
    });

    it('T15: dirty-local protection regression â€” pending outbox blocks overwrite', () => {
        const coord = new SqliteSyncCoordinator();
        
        db.prepare(`INSERT INTO movements (id, json_data) VALUES ('mov-dirty', '{"id":"mov-dirty","amount":9999}')`).run();
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('edirty', 'Movement', 'mov-dirty', 'UPDATE', '{}', 'PENDING', ?, ?, 200, 0)`).run(new Date().toISOString(), new Date().toISOString());

        db.exec('BEGIN IMMEDIATE;');
        coord['applyRemoteRow'](db, { id: 'mov-dirty', amount: 1 }, 'movements', 'movements', 'Movement', 'garage-A');
        db.exec('COMMIT;');

        const local = db.prepare('SELECT json_data FROM movements WHERE id = ?').get('mov-dirty') as any;
        const parsed = JSON.parse(local.json_data);
        expect(parsed.amount).toBe(9999);
    });
});

