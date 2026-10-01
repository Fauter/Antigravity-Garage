import { Debt } from '../../../shared/schemas';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';
import { CanonicalEntityHelper } from '../../../infrastructure/database/sqlite/CanonicalEntityHelper';

import { CanonFactory } from '../domain/CanonFactory';
import { BillingPeriodHelper } from '../../Billing/domain/BillingPeriodHelper';
import { DebtSelector } from '../../Billing/domain/DebtSelector';

export class SqliteDebtRepository extends BaseSqliteRepository<Debt> {
    constructor() {
        super('debts', 'Debt');
    }

    async findBySubscriptionIdAndMonth(subscriptionId: string, monthStart: Date, monthEnd: Date): Promise<Debt[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT id, json_data FROM debts WHERE json_extract(json_data, '$.subscriptionId') = ?`).all(subscriptionId) as any[];
        const parsed = rows.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
        const canonical = CanonicalEntityHelper.resolveCanonical<Debt>(parsed, 'Debt');
        
        return canonical.filter(d => {
            const dueDate = new Date(d.dueDate);
            return dueDate >= monthStart && dueDate <= monthEnd;
        });
    }

    async findByCustomerId(customerId: string): Promise<Debt[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT id, json_data FROM debts WHERE json_extract(json_data, '$.customerId') = ?`).all(customerId) as any[];
        const parsed = rows.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
        return CanonicalEntityHelper.resolveCanonical<Debt>(parsed, 'Debt');
    }

    async findBySubscriptionId(subscriptionId: string): Promise<Debt[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT id, json_data FROM debts WHERE json_extract(json_data, '$.subscriptionId') = ?`).all(subscriptionId) as any[];
        const parsed = rows.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
        return CanonicalEntityHelper.resolveCanonical<Debt>(parsed, 'Debt');
    }

    async findCanonBySubscriptionAndPeriod(subscriptionId: string, billingPeriod: string): Promise<Debt | null> {
        const canonicalId = CanonFactory.getCanonicalId(subscriptionId, billingPeriod);
        
        const db = SQLiteManager.getInstance().getDatabase();
        // Since FASE 1 identity is canonicalized to UUID, we can just search by id
        const row = db.prepare(`SELECT id, json_data FROM debts WHERE id = ?`).get(canonicalId) as any;
        if (row) {
            return { id: row.id, ...JSON.parse(row.json_data) };
        }
        
        // Fallback for legacy rows (NeDB ones without canonical UUID)
        const allRows = db.prepare(`SELECT id, json_data FROM debts WHERE json_extract(json_data, '$.subscriptionId') = ? AND json_extract(json_data, '$.type') = 'CANON'`).all(subscriptionId) as any[];
        const parsed = allRows.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
        const canonical = CanonicalEntityHelper.resolveCanonical<Debt>(parsed, 'Debt');
        
        return canonical.find(d => {
            try {
                return BillingPeriodHelper.getLegacyBillingPeriod(d) === billingPeriod;
            } catch (e) {
                return false;
            }
        }) || null;
    }

    async findCanonBySubscriptionGarageAndPeriod(subscriptionId: string, garageId: string, billingPeriod: string): Promise<Debt | null> {
        const allDebts = await this.findBySubscriptionId(subscriptionId);
        const matched = allDebts.filter(d => 
            ((d as any).garageId === garageId || (d as any).garage_id === garageId) &&
            d.type === 'CANON' &&
            DebtSelector.getBillingPeriodKey(d) === billingPeriod
        );

        if (matched.length > 0) {
            return matched[0];
        }
        return null;
    }

    async save(debt: Debt, arg2?: any, arg3?: any): Promise<Debt> {
        let externalTx: any = undefined;
        if (arg2 && typeof arg2 === 'object') {
            externalTx = arg2;
        } else if (arg3 && typeof arg3 === 'object') {
            externalTx = arg3;
        }

        const existingDebt = await this.findById(debt.id);

        if (existingDebt) {
            // IDEMPOTENCY DEEP CHECK: Prevent infinite loop of identical updates
            if (existingDebt.amount === debt.amount && existingDebt.status === debt.status && (existingDebt as any).remaining_amount === (debt as any).remaining_amount) {
                return existingDebt;
            }
        }
        
        // --- LOGICAL DEBT SYNC: Propagate to all physical rows ---
        if (debt.type === 'CANON' && debt.subscriptionId) {
            let bp = (debt as any).billingPeriod;
            if (!bp) {
                try {
                    bp = BillingPeriodHelper.getLegacyBillingPeriod(debt);
                } catch (e) {}
            }
            if (bp) {
                const canonicalId = CanonFactory.getCanonicalId(debt.subscriptionId, bp);
                if (debt.id === canonicalId) {
                    const db = SQLiteManager.getInstance().getDatabase();
                    const allRows = db.prepare(`SELECT id, json_data FROM debts WHERE json_extract(json_data, '$.subscriptionId') = ? AND json_extract(json_data, '$.type') = 'CANON'`).all(debt.subscriptionId) as any[];
                    for (const row of allRows) {
                        if (row.id === canonicalId) continue;
                        const parsed = { id: row.id, ...JSON.parse(row.json_data) };
                        try {
                            if (BillingPeriodHelper.getLegacyBillingPeriod(parsed) === bp) {
                                // Sync financial state to legacy duplicate
                                parsed.status = debt.status;
                                parsed.amount_paid = (debt as any).amount_paid;
                                parsed.remaining_amount = (debt as any).remaining_amount;
                                parsed.updatedAt = debt.updatedAt || new Date().toISOString();
                                
                                await super.save(parsed as unknown as Debt, 'UPDATE', externalTx);
                            }
                        } catch(e) {}
                    }
                }
            }
        }

        if (existingDebt) {
            return await super.save(debt, 'UPDATE', externalTx);
        } else {
            return await super.save(debt, 'CREATE', externalTx);
        }
    }
}
