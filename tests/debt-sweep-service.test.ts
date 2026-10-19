import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import { CanonFactory } from '../src/modules/Garage/domain/CanonFactory';
import { DebtSweepService } from '../src/modules/Garage/application/DebtSweepService';
import fs from 'fs';

describe('DebtSweepService', () => {
    const testDbPath = '.data/garageia-test-sweep-service.sqlite';
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

    // Helper to run service with mocked dependencies to avoid setting up configuration and vehicle tables
    async function runServiceWithMocks(subs: any[], currentNow: string) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(currentNow));

        const subRepoMock = {
            findAll: async () => subs
        };
        const vehRepoMock = {
            findById: async () => null,
            findByPlate: async () => null
        };
        const configRepoMock = {
            getPrices: async () => [{ amount: 1000 }],
            getVehicleTypes: async () => [],
            getTariffs: async () => []
        };
        const cocheraRepoMock = {
            findAll: async () => [{ clienteId: 'c1', precioBase: 1000 }]
        };

        const result = await DebtSweepService.runForGarage('garage-1', {
            subscriptionRepo: subRepoMock,
            debtRepo: debtRepo, // Real repo!
            vehicleRepo: vehRepoMock,
            configRepo: configRepoMock,
            cocheraRepo: cocheraRepoMock
        });

        vi.useRealTimers();
        return result;
    }

    it('1. Coverage fin Agosto, hoy Septiembre -> create 1', async () => {
        const sub = { id: 's1', garageId: 'garage-1', active: true, endDate: '2026-08-31T23:59:59Z', customerId: 'c1' };
        // Date is mid-Sept
        const res = await runServiceWithMocks([sub], '2026-09-15T12:00:00Z');
        
        expect(res.created).toBe(1);
        expect(res.evaluatedPeriods).toBe(1);

        const allDebts = await debtRepo.findAll();
        expect(allDebts.length).toBe(1);
        expect(allDebts[0].billingPeriod).toBe('2026-09');
        expect(allDebts[0].amount).toBe(1000);
        expect(allDebts[0].garageId).toBe('garage-1');
        
        // Verify outbox event was generated for offline sync
        const db = SQLiteManager.getInstance().getDatabase();
        const events = db.prepare('SELECT * FROM outbox_events').all();
        expect(events.length).toBeGreaterThan(0);
    });

    it('2. Coverage fin Julio, hoy Septiembre -> create Agosto + Septiembre', async () => {
        const sub = { id: 's2', garageId: 'garage-1', active: true, endDate: '2026-07-31T23:59:59Z', customerId: 'c1' };
        const res = await runServiceWithMocks([sub], '2026-09-15T12:00:00Z');
        
        expect(res.created).toBe(2);
        
        const allDebts = await debtRepo.findAll();
        expect(allDebts.length).toBe(2);
        expect(allDebts.some(d => d.billingPeriod === '2026-08')).toBe(true);
        expect(allDebts.some(d => d.billingPeriod === '2026-09')).toBe(true);
    });

    it('3. Re-ejecucion -> create 0 (Idempotency)', async () => {
        const sub = { id: 's3', garageId: 'garage-1', active: true, endDate: '2026-08-31T23:59:59Z', customerId: 'c1' };
        
        // Run 1
        const res1 = await runServiceWithMocks([sub], '2026-09-15T12:00:00Z');
        expect(res1.created).toBe(1);

        // Run 2
        const res2 = await runServiceWithMocks([sub], '2026-09-15T12:00:00Z');
        expect(res2.created).toBe(0);
        expect(res2.existing).toBe(1);
    });

    it('4 & 5. Agosto PAID, Sept inexistente -> create solo Sept, no revive PAID', async () => {
        const sub = { id: 's4', garageId: 'garage-1', active: true, endDate: '2026-07-31T23:59:59Z', customerId: 'c1' };
        
        // Artificialmente insertamos Agosto como PAID
        const augDebt = CanonFactory.createCanonDebt(sub.id, sub.customerId, 1000, '2026-08', CanonFactory.getCanonDueDate(2026, 7), 'garage-1');
        augDebt.status = 'PAID';
        await debtRepo.save(augDebt);

        const res = await runServiceWithMocks([sub], '2026-09-15T12:00:00Z');
        expect(res.created).toBe(1); // Solo Septiembre
        expect(res.existing).toBe(1); // Encontro Agosto
        
        const allDebts = await debtRepo.findAll();
        const augInDb = allDebts.find(d => d.billingPeriod === '2026-08');
        expect(augInDb?.status).toBe('PAID'); // NO se revivio a PENDING
    });

    it('6. Inactive -> create 0', async () => {
        const sub = { id: 's5', garageId: 'garage-1', active: false, endDate: '2026-08-31T23:59:59Z', customerId: 'c1' };
        const res = await runServiceWithMocks([sub], '2026-09-15T12:00:00Z');
        expect(res.created).toBe(0);
        expect(res.evaluatedSubscriptions).toBe(0); // Filtrada
    });

    it('7. Otro garage -> create 0', async () => {
        const sub = { id: 's6', garageId: 'garage-2', active: true, endDate: '2026-08-31T23:59:59Z', customerId: 'c1' };
        const res = await runServiceWithMocks([sub], '2026-09-15T12:00:00Z');
        expect(res.created).toBe(0);
        expect(res.evaluatedSubscriptions).toBe(0); // Filtrada por garageId
    });

    it('8. Sin precio -> skip', async () => {
        const sub = { id: 's7', garageId: 'garage-1', active: true, endDate: '2026-08-31T23:59:59Z', customerId: 'c1' };
        
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));

        const subRepoMock = { findAll: async () => [sub] };
        const vehRepoMock = { findById: async () => null, findByPlate: async () => null };
        const configRepoMock = { 
            getPrices: async () => [], // Vacio, price será 0
            getVehicleTypes: async () => [], getTariffs: async () => [] 
        };
        const cocheraRepoMock = { findAll: async () => [] };

        const res = await DebtSweepService.runForGarage('garage-1', {
            subscriptionRepo: subRepoMock, debtRepo, vehicleRepo: vehRepoMock, configRepo: configRepoMock, cocheraRepo: cocheraRepoMock
        });

        vi.useRealTimers();

        expect(res.skipped).toBe(1);
        expect(res.created).toBe(0);
    });

    it('10. Dos sweeps concurrentes -> devuelve rapido la segunda por lock', async () => {
        const sub = { id: 's8', garageId: 'garage-1', active: true, endDate: '2026-08-31T23:59:59Z', customerId: 'c1' };
        
        const subRepoMock = {
            findAll: async () => new Promise(resolve => setTimeout(() => resolve([sub]), 50))
        };
        const vehRepoMock = { findById: async () => null, findByPlate: async () => null };
        const configRepoMock = { getPrices: async () => [{ amount: 1000 }], getVehicleTypes: async () => [], getTariffs: async () => [] };
        const cocheraRepoMock = { findAll: async () => [{ clienteId: 'c1', precioBase: 1000 }] };

        const promise1 = DebtSweepService.runForGarage('garage-1', {
            subscriptionRepo: subRepoMock, debtRepo, vehicleRepo: vehRepoMock, configRepo: configRepoMock, cocheraRepo: cocheraRepoMock
        });

        const promise2 = DebtSweepService.runForGarage('garage-1', {
            subscriptionRepo: subRepoMock, debtRepo, vehicleRepo: vehRepoMock, configRepo: configRepoMock, cocheraRepo: cocheraRepoMock
        });

        const [res1, res2] = await Promise.all([promise1, promise2]);
        
        expect(res1.created + res2.created).toBe(1);
        expect(res1.evaluatedSubscriptions + res2.evaluatedSubscriptions).toBe(1);
        
        const allDebts = await debtRepo.findAll();
        expect(allDebts.length).toBe(1);
    });
});
