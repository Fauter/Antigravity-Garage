import { Debt } from '../../../shared/schemas';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';

export class SqliteDebtRepository extends BaseSqliteRepository<Debt> {
    constructor() {
        super('debts', 'Debt');
    }

    async findBySubscriptionIdAndMonth(subscriptionId: string, monthStart: Date, monthEnd: Date): Promise<Debt[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM debts WHERE json_extract(json_data, '$.subscriptionId') = ?`).all(subscriptionId) as any[];
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        return parsed.filter(d => {
            const dueDate = new Date(d.dueDate);
            return dueDate >= monthStart && dueDate <= monthEnd;
        });
    }

    async findByCustomerId(customerId: string): Promise<Debt[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM debts WHERE json_extract(json_data, '$.customerId') = ?`).all(customerId) as any[];
        return rows.map(r => JSON.parse(r.json_data));
    }

    async findBySubscriptionId(subscriptionId: string): Promise<Debt[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM debts WHERE json_extract(json_data, '$.subscriptionId') = ?`).all(subscriptionId) as any[];
        return rows.map(r => JSON.parse(r.json_data));
    }

    async save(debt: Debt): Promise<Debt> {
        const existingDebt = await this.findById(debt.id);

        if (existingDebt) {
            // IDEMPOTENCY DEEP CHECK: Prevent infinite loop of identical updates
            if (existingDebt.amount === debt.amount && existingDebt.status === debt.status && (existingDebt as any).remaining_amount === (debt as any).remaining_amount) {
                // If the critical fields haven't changed, ignore the save and don't queue.
                return existingDebt;
            }
            
            return await super.save(debt, 'UPDATE');
        } else {
            return await super.save(debt, 'CREATE');
        }
    }
}
