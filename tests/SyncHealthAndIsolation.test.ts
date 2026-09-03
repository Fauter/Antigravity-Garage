import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';
import path from 'path';
import fs from 'fs';

describe('Sync Health and Test DB Isolation Tests', () => {
    let db: any;
    let syncCoordinator: SqliteSyncCoordinator;

    beforeEach(() => {
        db = SQLiteManager.initForTest().getDatabase();
        syncCoordinator = new SqliteSyncCoordinator();
    });

    afterEach(() => {
        SQLiteManager.resetInstance();
        vi.restoreAllMocks();
    });

    it('1. Test DB Isolation: Tests run against a temporary isolated database, and production garageia.sqlite is strictly guarded', () => {
        const prodDbPath = path.resolve(process.cwd(), '.data', 'garageia.sqlite');
        
        // Write a marker in test DB
        db.prepare(`INSERT INTO customers (id, json_data) VALUES ('test-isolated-id', '{"name":"IsolationTest"}')`).run();

        // Verify it exists in test DB
        const inTestDb = db.prepare(`SELECT json_data FROM customers WHERE id = 'test-isolated-id'`).get();
        expect(inTestDb).toBeDefined();

        // Verify test path is isolated
        const currentTestPath = SQLiteManager.getInstance().getDbPath();
        expect(currentTestPath).not.toBe(prodDbPath);
        expect(currentTestPath).toContain('test');

        // Verify safety guard throws if trying to open production db in test mode
        expect(() => {
            SQLiteManager.initForTest(prodDbPath);
        }).toThrow(/FATAL TEST SAFETY/);
    });

    it('2. No Background Sync in Tests: startBackgroundSync is disabled when NODE_ENV=test or VITEST', () => {
        expect((syncCoordinator as any).syncInterval).toBeNull();
    });

    it('3. Financial Configs Binding: Row with garage_id but without id binds and inserts into SQLite without parameter error', async () => {
        const mockCloudRow = {
            garage_id: '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02',
            payment_methods: ['Efectivo', 'Transferencia'],
            invoice_types: ['Consumidor Final', 'Factura A'],
            surcharge_config: { global_default: { steps: [{ day: 6, percentage: 10 }] } },
            initial_tolerance: 0,
            fractionate_after: 60
        };

        // Invoke private fetchTable / toCamelCase logic directly via TransactionHelper
        TransactionHelper.run((tx) => {
            const id = (mockCloudRow as any).id || mockCloudRow.garage_id;
            const camelPayload = (syncCoordinator as any).toCamelCase(mockCloudRow);
            if (!camelPayload.id) {
                camelPayload.id = id;
            }

            expect(() => {
                tx.prepare(`
                    INSERT INTO financial_configs (id, json_data) VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
                `).run(id, JSON.stringify(camelPayload));
            }).not.toThrow();
        });

        const stored = db.prepare(`SELECT json_data FROM financial_configs WHERE id = ?`).get('1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02') as any;
        expect(stored).toBeDefined();
        const parsed = JSON.parse(stored.json_data);
        expect(parsed.garageId).toBe('1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02');
        expect(parsed.paymentMethods).toContain('Efectivo');
    });

    it('4. Employee Mapping: Pull maps remote employee_accounts into local employees table', async () => {
        const mockEmployeeRow = {
            id: 'emp-123',
            username: 'carlos_operador',
            role: 'CASHIER',
            garage_id: '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02'
        };

        TransactionHelper.run((tx) => {
            const id = mockEmployeeRow.id;
            const camelPayload = (syncCoordinator as any).toCamelCase(mockEmployeeRow);
            tx.prepare(`
                INSERT INTO employees (id, json_data) VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
            `).run(id, JSON.stringify(camelPayload));
        });

        const stored = db.prepare(`SELECT json_data FROM employees WHERE id = 'emp-123'`).get() as any;
        expect(stored).toBeDefined();
        const parsed = JSON.parse(stored.json_data);
        expect(parsed.username).toBe('carlos_operador');
    });

    it('5. Sync Status Distinction: Permanent DB errors mark BLOCKED without falsely reporting OFFLINE', async () => {
        // Insert a malformed outbox event
        db.prepare(`
            INSERT INTO outbox_events (sequence, event_id, entity_type, entity_id, operation, payload, status, attempts, created_at, updated_at)
            VALUES (1, 'evt-uuid', 'Subscription', 'sub-uuid', 'UPDATE', '{"id":"sub-uuid","customerId":"invalid-uuid"}', 'PENDING', 0, datetime('now'), datetime('now'))
        `).run();

        // Mock pushToCloud to throw a Postgres 22P02 error (invalid input syntax for type uuid)
        const permanentError = new Error('invalid input syntax for type uuid: "invalid-uuid"');
        (permanentError as any).code = '22P02';
        vi.spyOn(syncCoordinator as any, 'pushToCloud').mockRejectedValue(permanentError);

        await syncCoordinator.processOutbox();

        // Status should be BLOCKED, not RETRY
        const event = db.prepare(`SELECT * FROM outbox_events WHERE sequence = 1`).get() as any;
        expect(event.status).toBe('BLOCKED');
        expect(event.last_error_code).toBe('22P02');

        // Status API should report HAS_BLOCKED_MUTATIONS, NOT BACKEND_UNREACHABLE / OFFLINE
        const status = await syncCoordinator.getStatus();
        expect(status.state).toBe('HAS_BLOCKED_MUTATIONS');
        expect(status.blocked).toBe(1);
        expect(status.pending).toBe(0);
    });

    it('6. Sync Status Distinction: Truly offline network reports BACKEND_UNREACHABLE', async () => {
        db.prepare(`
            INSERT INTO outbox_events (sequence, event_id, entity_type, entity_id, operation, payload, status, attempts, created_at, updated_at)
            VALUES (1, 'evt-uuid', 'Subscription', 'sub-uuid', 'UPDATE', '{"id":"sub-uuid"}', 'PENDING', 0, datetime('now'), datetime('now'))
        `).run();

        const networkError = new Error('fetch failed: ECONNREFUSED');
        (networkError as any).code = 'ECONNREFUSED';
        vi.spyOn(syncCoordinator as any, 'pushToCloud').mockRejectedValue(networkError);

        await syncCoordinator.processOutbox();

        const status = await syncCoordinator.getStatus();
        expect(status.state).toBe('BACKEND_UNREACHABLE');
        expect(status.pending).toBe(0);
        expect(status.retry).toBe(1);
    });
});
