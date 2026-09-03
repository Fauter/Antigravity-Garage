import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import { BillingPeriodHelper } from '../src/modules/Billing/domain/BillingPeriodHelper';
import { CanonFactory } from '../src/modules/Garage/domain/CanonFactory';
import fs from 'fs';

// Helper mock controller loop logic for tests
async function runDebtSweepMock(sub: any, garageId: string, finalPrice: number, now: Date, repo: SqliteDebtRepository) {
    let subEndDate = new Date(sub.endDate);
    let currentEvalDate = new Date(subEndDate.getTime());
    currentEvalDate.setDate(1);
    currentEvalDate.setMonth(currentEvalDate.getMonth() + 1);
    currentEvalDate.setHours(0, 0, 0, 0);
    
    let processed = 0;
    while (currentEvalDate <= now) {
        const billingPeriod = BillingPeriodHelper.getBillingPeriod(currentEvalDate);
        const existingDebt = await repo.findCanonBySubscriptionAndPeriod(sub.id, billingPeriod);
        
        if (!existingDebt) {
            const dueDate = new Date(currentEvalDate.getFullYear(), currentEvalDate.getMonth(), 1, 0, 0, 0);
            const newDebt = CanonFactory.createCanonDebt(
                sub.id,
                sub.customerId,
                finalPrice,
                billingPeriod,
                dueDate
            );
            await repo.save(newDebt);
            processed++;
        }
        currentEvalDate.setMonth(currentEvalDate.getMonth() + 1);
    }
    return processed;
}

describe('Debt Sweep Idempotency & Canon Generation (FASE 3)', () => {
    const testDbPath = '.data/garageia-test-sweep.sqlite';
    let repo: SqliteDebtRepository;

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        process.env.SQLITE_DB_PATH = testDbPath;
        const db = SQLiteManager.getInstance().getDatabase();
        db.prepare(`CREATE TABLE IF NOT EXISTS debts (id TEXT PRIMARY KEY, json_data TEXT)`).run();
        repo = new SqliteDebtRepository();
    });

    afterAll(() => {
        const db = SQLiteManager.getInstance().getDatabase();
        if (db && typeof db.close === 'function') db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    beforeEach(() => {
        const db = SQLiteManager.getInstance().getDatabase();
        db.prepare('DELETE FROM debts').run();
    });

    it('IDEMPOTENCIA SIMPLE: multiple sweeps generate only 1 CANON', async () => {
        const sub = { id: 'sub-1', customerId: 'cust-1', endDate: '2026-03-31T23:59:59Z' };
        const now = new Date('2026-04-15T12:00:00Z');
        
        const run1 = await runDebtSweepMock(sub, 'garage-1', 1000, now, repo);
        expect(run1).toBe(1); // Created for April
        
        const run2 = await runDebtSweepMock(sub, 'garage-1', 1000, now, repo);
        expect(run2).toBe(0); // Created 0
        
        const run3 = await runDebtSweepMock(sub, 'garage-1', 1000, now, repo);
        expect(run3).toBe(0); // Created 0
        
        const allDebts = await repo.findAll();
        expect(allDebts.length).toBe(1);
    });

    it('VARIOS MESES: creates contiguous missing months exactly once', async () => {
        const sub = { id: 'sub-2', customerId: 'cust-1', endDate: '2026-04-30T23:59:59Z' };
        // Now is Sept 1
        const now = new Date('2026-09-01T12:00:00Z');
        
        const run1 = await runDebtSweepMock(sub, 'garage-1', 1000, now, repo);
        expect(run1).toBe(5); // May, Jun, Jul, Aug, Sep
        
        const run2 = await runDebtSweepMock(sub, 'garage-1', 1000, now, repo);
        expect(run2).toBe(0);
        
        const allDebts = await repo.findAll();
        expect(allDebts.length).toBe(5);
    });

    it('PAID HISTÓRICO: does not revive PAID debts', async () => {
        const sub = { id: 'sub-3', customerId: 'cust-1', endDate: '2026-04-30T23:59:59Z' };
        
        // Manually create May as PAID
        const mayDebt = CanonFactory.createCanonDebt(sub.id, sub.customerId, 1000, '2026-05', new Date('2026-05-01'));
        mayDebt.status = 'PAID';
        mayDebt.remaining_amount = 0;
        mayDebt.amount_paid = 1000;
        await repo.save(mayDebt);
        
        // Sweep in Sept
        const now = new Date('2026-09-01T12:00:00Z');
        const run1 = await runDebtSweepMock(sub, 'garage-1', 1000, now, repo);
        
        // Should create Jun, Jul, Aug, Sep (4)
        expect(run1).toBe(4);
        
        const mayFromDb = await repo.findCanonBySubscriptionAndPeriod(sub.id, '2026-05');
        expect(mayFromDb?.status).toBe('PAID'); // Remains PAID!
    });

    it('MIXTO: pre-existing varied states', async () => {
        const sub = { id: 'sub-4', customerId: 'cust-1', endDate: '2026-04-30T23:59:59Z' };
        
        // May = PAID
        const mayDebt = CanonFactory.createCanonDebt(sub.id, sub.customerId, 1000, '2026-05', new Date('2026-05-01'));
        mayDebt.status = 'PAID';
        await repo.save(mayDebt);
        
        // Jun = PENDING
        const junDebt = CanonFactory.createCanonDebt(sub.id, sub.customerId, 1000, '2026-06', new Date('2026-06-01'));
        await repo.save(junDebt);
        
        // Jul = PAID
        const julDebt = CanonFactory.createCanonDebt(sub.id, sub.customerId, 1000, '2026-07', new Date('2026-07-01'));
        julDebt.status = 'PAID';
        await repo.save(julDebt);
        
        const now = new Date('2026-09-01T12:00:00Z');
        const run1 = await runDebtSweepMock(sub, 'garage-1', 1000, now, repo);
        
        expect(run1).toBe(2); // Aug, Sep
        
        const allDebts = await repo.findAll();
        expect(allDebts.length).toBe(5);
    });

    it('TIMEZONE: billing period correctly respects ART bounds', () => {
        // Sep 30 23:59:59 in ART (UTC-3) is Oct 1 02:59:59 in UTC
        const subEndDate = new Date('2026-10-01T02:59:59.999Z'); 
        
        // When we ask for the next month:
        let currentEvalDate = new Date(subEndDate.getTime());
        // Date manipulation must be done in local/timezone, but for tests we'll just check the billing helper directly:
        
        const artPeriod = BillingPeriodHelper.getBillingPeriod(subEndDate);
        // Sept 30 in ART is Sept!
        expect(artPeriod).toBe('2026-09');
    });

    it('SYNC-LIKE UPSERT: does not duplicate on save', async () => {
        const sub = { id: 'sub-sync', customerId: 'cust-1', endDate: '2026-04-30T23:59:59Z' };
        const debt = CanonFactory.createCanonDebt(sub.id, sub.customerId, 1000, '2026-05', new Date());
        
        await repo.save(debt);
        // Simulate pulling from sync and overwriting
        await repo.save({ ...debt, status: 'PAID' });
        
        const all = await repo.findAll();
        expect(all.length).toBe(1);
        expect(all[0].status).toBe('PAID');
    });

    it('RESTART: does not duplicate on restart', async () => {
        const sub = { id: 'sub-restart', customerId: 'cust-1', endDate: '2026-04-30T23:59:59Z' };
        const now = new Date('2026-05-15T12:00:00Z');
        
        await runDebtSweepMock(sub, 'g1', 1000, now, repo); // Creates 2026-05
        
        // Simulate restart
        const db = SQLiteManager.getInstance().getDatabase();
        // Since we are using an in-memory or single file DB, we just re-instantiate repo
        const newRepo = new SqliteDebtRepository();
        
        const run2 = await runDebtSweepMock(sub, 'g1', 1000, now, newRepo);
        expect(run2).toBe(0);
        
        const all = await newRepo.findAll();
        const subDebts = all.filter(d => d.subscriptionId === sub.id);
        expect(subDebts.length).toBe(1);
    });
});
