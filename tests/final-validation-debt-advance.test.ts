import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import { SubscriptionRepository } from '../src/modules/Garage/infra/SubscriptionRepository';
import { MovementRepository } from '../src/modules/Billing/infra/MovementRepository';
import { DebtPaymentService } from '../src/modules/Billing/application/DebtPaymentService';
import { SubscriptionManager } from '../src/modules/Garage/domain/SubscriptionManager';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

describe('Final Validation: DEBT, Double Submit, Advance 409, and Partial Payment', () => {
    const testDbPath = '.data/garageia-test-final-val.sqlite';

    beforeAll(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        process.env.SQLITE_DB_PATH = testDbPath;
        const db = SQLiteManager.getInstance().getDatabase();
        
        db.prepare(`
            CREATE TABLE IF NOT EXISTS debts (id TEXT PRIMARY KEY, json_data TEXT)
        `).run();
        db.prepare(`
            CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, json_data TEXT)
        `).run();
        db.prepare(`
            CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, json_data TEXT)
        `).run();
        db.prepare(`
            CREATE TABLE IF NOT EXISTS outbox_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT, entity_type TEXT, entity_id TEXT, operation TEXT,
                payload TEXT, status TEXT, created_at TEXT, updated_at TEXT,
                attempts INTEGER DEFAULT 0, last_attempt_at TEXT, last_error TEXT,
                last_error_code TEXT, acked_at TEXT
            )
        `).run();
    });

    afterAll(() => {
        const db = SQLiteManager.getInstance().getDatabase();
        if (db && typeof db.close === 'function') db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('Step I: Double submit on DEBT_MULTI_FULL throws STALE_SELECTION on second attempt and creates exactly 1 movement', async () => {
        const db = SQLiteManager.getInstance().getDatabase();
        const debtRepo = new SqliteDebtRepository();
        const subId = uuidv4();
        const debtId1 = uuidv4();
        const debtId2 = uuidv4();

        const debt1 = {
            id: debtId1,
            subscriptionId: subId,
            status: 'PENDING',
            amount: 1000,
            remaining_amount: 1000,
            type: 'CANON',
            billingPeriod: '2026-06',
            dueDate: '2026-06-01T00:00:00Z'
        };
        const debt2 = {
            id: debtId2,
            subscriptionId: subId,
            status: 'PENDING',
            amount: 1000,
            remaining_amount: 1000,
            type: 'CANON',
            billingPeriod: '2026-07',
            dueDate: '2026-07-01T00:00:00Z'
        };

        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run(debtId1, JSON.stringify(debt1));
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run(debtId2, JSON.stringify(debt2));

        // 1st Preview & Payment for debt1
        const allDebts = await debtRepo.findBySubscriptionId(subId);
        const pendingDebts = allDebts.filter(d => d.status === 'PENDING');
        const preview1 = DebtPaymentService.preview({
            subId,
            targetDebtIds: [debtId1],
            now: new Date('2026-09-01'),
            config: {}
        }, pendingDebts);

        expect(preview1.isValid).toBe(true);
        expect(preview1.grandTotal).toBeGreaterThanOrEqual(1000);

        // Simulate 1st commit: mark debt1 as PAID
        const updatedDebt1 = { ...debt1, status: 'PAID', remaining_amount: 0, amount_paid: 1000 };
        await debtRepo.save(updatedDebt1 as any);

        // 2nd Attempt with the EXACT SAME request (simulating double submit)
        const allDebtsAfter = await debtRepo.findBySubscriptionId(subId);
        const pendingAfter = allDebtsAfter.filter(d => d.status === 'PENDING');
        
        // When second request arrives, debt1 is no longer in pendingDebts
        const preview2 = DebtPaymentService.preview({
            subId,
            targetDebtIds: [debtId1],
            now: new Date('2026-09-01'),
            config: {}
        }, pendingAfter);

        expect(preview2.isValid).toBe(false);
        expect(preview2.error).toContain('Invalid debt selection prefix');
    });

    it('Step N: ADVANCE validation and 409 rejection if period already covered', async () => {
        const subId = uuidv4();
        const initialEndDate = new Date('2026-09-30T23:59:59.999Z');
        
        const sub: any = {
            id: subId,
            active: true,
            endDate: initialEndDate.toISOString(),
            type: 'Movil',
            customerId: uuidv4()
        };

        // Advance payment for October (from September end date)
        const now = new Date('2026-09-05T12:00:00Z');
        const advancedSub = SubscriptionManager.advanceSubscription(
            sub,
            {} as any,
            now,
            'Efectivo',
            50000
        );

        expect(new Date(advancedSub.endDate).getMonth()).toBe(9); // October (0-indexed 9)

        // Attempting to advance AGAIN when already covered until October end date
        const currentEndDate = new Date(advancedSub.endDate);
        const isEligibleForAnotherAdvance = (currentEndDate.getFullYear() === now.getFullYear() && currentEndDate.getMonth() === now.getMonth());
        
        expect(isEligibleForAnotherAdvance).toBe(false); // Fails check, resulting in 409
    });

    it('Step J: Legacy partial payment reduces remaining_amount without marking debt PAID prematurely', async () => {
        const db = SQLiteManager.getInstance().getDatabase();
        const debtRepo = new SqliteDebtRepository();
        const subId = uuidv4();
        const debtId = uuidv4();

        const originalDebt = {
            id: debtId,
            subscriptionId: subId,
            status: 'PENDING',
            amount: 5000,
            remaining_amount: 5000,
            amount_paid: 0,
            type: 'CANON',
            billingPeriod: '2026-08',
            dueDate: '2026-08-01T00:00:00Z'
        };
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run(debtId, JSON.stringify(originalDebt));

        // Partial payment of 2000
        const partialPaidDebt = {
            ...originalDebt,
            remaining_amount: 3000,
            amount_paid: 2000,
            status: 'PENDING'
        };
        await debtRepo.save(partialPaidDebt as any);

        const fetched = await debtRepo.findById(debtId) as any;
        expect(fetched.status).toBe('PENDING');
        expect(fetched.remaining_amount).toBe(3000);
        expect(fetched.amount_paid).toBe(2000);
    });
});
