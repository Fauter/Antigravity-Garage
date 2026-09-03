import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import { Debt } from '../src/shared/schemas';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { CanonFactory } from '../src/modules/Garage/domain/CanonFactory';
import { BillingPeriodHelper } from '../src/modules/Billing/domain/BillingPeriodHelper';

describe('Legacy CANON compatibility and DebtSweep idempotency', () => {
    const testDbPath = '.data/garageia-test-legacy-canon.sqlite';

    beforeAll(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        process.env.SQLITE_DB_PATH = testDbPath;
        const db = SQLiteManager.getInstance().getDatabase();
        
        db.prepare(`
            CREATE TABLE IF NOT EXISTS debts (id TEXT PRIMARY KEY, json_data TEXT)
        `).run();
    });

    afterAll(() => {
        const db = SQLiteManager.getInstance().getDatabase();
        if (db && typeof db.close === 'function') db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('findCanonBySubscriptionAndPeriod should resolve legacy CANON properly', async () => {
        const db = SQLiteManager.getInstance().getDatabase();
        const repo = new SqliteDebtRepository();
        
        const subId = uuidv4();
        
        // Simular CANON legacy sin billingPeriod, creado el 1 de Abril de 2026 y correspondiente históricamente a Mayo (dueDate 2026-05-01T02:59:59.999Z)
        const legacyDebt: any = {
            id: 'legacy-may-123',
            subscriptionId: subId,
            customerId: uuidv4(),
            amount: 860000,
            status: 'PAID',
            dueDate: '2026-05-01T02:59:59.999+00:00',
            createdAt: '2026-05-06T20:42:51.352+00:00',
            type: 'CANON'
            // No billingPeriod field!
        };
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run(legacyDebt.id, JSON.stringify(legacyDebt));

        // Buscar el de Mayo
        const mayDebt = await repo.findCanonBySubscriptionAndPeriod(subId, '2026-05');
        expect(mayDebt).not.toBeNull();
        expect(mayDebt?.id).toBe('legacy-may-123');

        // Buscar el de Abril (debería ser nulo)
        const aprilDebt = await repo.findCanonBySubscriptionAndPeriod(subId, '2026-04');
        expect(aprilDebt).toBeNull();
    });

    it('Multiple legacy CANONs are resolved correctly without overlap', async () => {
        const db = SQLiteManager.getInstance().getDatabase();
        const repo = new SqliteDebtRepository();
        
        const subId = uuidv4();
        
        const legacyDebts = [
            { id: 'leg-mar', dueDate: '2026-03-31T23:59:59+00:00', status: 'PAID' },
            { id: 'leg-apr', dueDate: '2026-04-30T23:59:59+00:00', status: 'PAID' },
            { id: 'leg-may', dueDate: '2026-05-01T02:59:59.999+00:00', status: 'PAID' },
            { id: 'leg-jun', dueDate: '2026-06-01T02:59:59.999+00:00', status: 'PENDING' },
        ];

        for (const d of legacyDebts) {
            const data = {
                id: d.id,
                subscriptionId: subId,
                status: d.status,
                dueDate: d.dueDate,
                type: 'CANON'
            };
            db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run(d.id, JSON.stringify(data));
        }

        const mar = await repo.findCanonBySubscriptionAndPeriod(subId, '2026-03');
        const apr = await repo.findCanonBySubscriptionAndPeriod(subId, '2026-04');
        const may = await repo.findCanonBySubscriptionAndPeriod(subId, '2026-05');
        const jun = await repo.findCanonBySubscriptionAndPeriod(subId, '2026-06');
        const jul = await repo.findCanonBySubscriptionAndPeriod(subId, '2026-07');

        expect(mar?.id).toBe('leg-mar');
        expect(apr?.id).toBe('leg-apr');
        expect(may?.id).toBe('leg-may');
        expect(jun?.id).toBe('leg-jun');
        expect(jul).toBeNull();
    });
});
