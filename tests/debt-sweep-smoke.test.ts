import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import { DebtSweepService } from '../src/modules/Garage/application/DebtSweepService';
import fs from 'fs';

describe('Debt Sweep Smoke Test', () => {
    const testDbPath = '.data/garageia-test-smoke.sqlite';
    let debtRepo: SqliteDebtRepository;

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        process.env.SQLITE_DB_PATH = testDbPath;
        
        const db = SQLiteManager.getInstance().getDatabase();
        // Required tables for the debt repo and outbox
        db.prepare(`CREATE TABLE IF NOT EXISTS debts (id TEXT PRIMARY KEY, json_data TEXT)`).run();
        db.prepare(`
            CREATE TABLE IF NOT EXISTS outbox_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                payload TEXT,
                status TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_attempt_at TEXT,
                next_attempt_at TEXT,
                acked_at TEXT,
                last_error TEXT,
                last_error_code TEXT
            )
        `).run();
        debtRepo = new SqliteDebtRepository();
    });

    afterAll(() => {
        const db = SQLiteManager.getInstance().getDatabase();
        if (db && typeof db.close === 'function') db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    beforeEach(() => {
        const db = SQLiteManager.getInstance().getDatabase();
        db.prepare('DELETE FROM debts').run();
        db.prepare('DELETE FROM outbox_events').run();
    });

    it('E2E: Detects missing CANON, creates exactly one with outbox, and skips on second pass', async () => {
        // 1. Arrange: simulated date and active subscription
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-17T12:00:00Z')); // Simulate 17/09/2026

        const sub = { 
            id: 'sub-smoke-123', 
            garageId: 'test-garage', 
            active: true, 
            endDate: '2026-08-31T23:59:59Z', // Coverage expired at the end of August
            customerId: 'c-test' 
        };

        const cocheraBasePrice = 860000;

        // Repositories Mocks
        const subRepoMock = { findAll: async () => [sub] };
        const vehRepoMock = { findById: async () => null, findByPlate: async () => null };
        const configRepoMock = { 
            getPrices: async () => [], 
            getVehicleTypes: async () => [], 
            getTariffs: async () => [] 
        };
        const cocheraRepoMock = { 
            findAll: async () => [{ clienteId: 'c-test', precioBase: cocheraBasePrice }] 
        };

        const dependencies = {
            subscriptionRepo: subRepoMock,
            debtRepo: debtRepo, // REAL SQLITE REPOSITORY
            vehicleRepo: vehRepoMock,
            configRepo: configRepoMock,
            cocheraRepo: cocheraRepoMock
        };

        // 2. Act: First Execution
        const run1 = await DebtSweepService.runForGarage('test-garage', dependencies);

        // 3. Assert: First Execution
        expect(run1.created).toBe(1);
        expect(run1.existing).toBe(0);

        // Check local DB for the created debt
        const allDebts = await debtRepo.findAll();
        expect(allDebts.length).toBe(1);
        const canon = allDebts[0];

        // Ensure fields are structurally correct
        expect(canon.type).toBe('CANON');
        expect(canon.billingPeriod).toBe('2026-09');
        expect(canon.status).toBe('PENDING');
        expect(canon.amount).toBe(cocheraBasePrice);
        expect((canon as any).remaining_amount).toBe(cocheraBasePrice);
        expect((canon as any).amount_paid).toBe(0);
        expect(canon.surchargeApplied).toBe(0);
        expect(canon.garageId).toBe('test-garage');

        // Check the outbox_event
        const db = SQLiteManager.getInstance().getDatabase();
        const outboxEvents = db.prepare(`SELECT * FROM outbox_events`).all() as any[];
        expect(outboxEvents.length).toBe(1);
        
        const event = outboxEvents[0];
        expect(event.entity_type).toBe('Debt');
        expect(event.entity_id).toBe(canon.id);
        expect(event.operation).toBe('CREATE');
        expect(event.status).toBe('PENDING');

        const payload = JSON.parse(event.payload);
        expect(payload.id).toBe(canon.id);
        expect(payload.billingPeriod).toBe('2026-09');

        // 4. Act: Second Execution (Idempotency)
        const run2 = await DebtSweepService.runForGarage('test-garage', dependencies);

        // 5. Assert: Second Execution
        expect(run2.created).toBe(0);
        expect(run2.existing).toBe(1);

        // Still exactly 1 debt in the local DB
        const debtsPass2 = await debtRepo.findAll();
        expect(debtsPass2.length).toBe(1);

        // Still exactly 1 event in the outbox
        const outboxPass2 = db.prepare(`SELECT * FROM outbox_events`).all() as any[];
        expect(outboxPass2.length).toBe(1);

        vi.useRealTimers();
    });
});
