import { Debt } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteDebtRepository } from './SqliteDebtRepository.js';

export class NeDBDebtRepository {
    private queue = new QueueService();

    async findBySubscriptionIdAndMonth(subscriptionId: string, monthStart: Date, monthEnd: Date): Promise<Debt[]> {
        const allDebts = await db.debts.find({ subscriptionId }) as Debt[];
        return allDebts.filter(d => {
            const dueDate = new Date(d.dueDate);
            return dueDate >= monthStart && dueDate <= monthEnd;
        });
    }

    async findById(id: string): Promise<Debt | undefined> {
        return await db.debts.findOne({ id }) as Debt | undefined;
    }

    async save(debt: Debt): Promise<Debt> {
        const existingDebt = await db.debts.findOne({ id: debt.id }) as Debt | undefined;

        if (existingDebt) {
            if (existingDebt.amount === debt.amount && existingDebt.status === debt.status && (existingDebt as any).remaining_amount === (debt as any).remaining_amount) {
                return existingDebt;
            }
            await db.debts.update({ id: debt.id }, { $set: debt }, { multi: false });
            const updated = await db.debts.findOne({ id: debt.id }) as Debt;
            await this.queue.enqueue('Debt', 'UPDATE', updated);
            return updated;
        } else {
            await db.debts.insert(debt);
            await this.queue.enqueue('Debt', 'CREATE', debt);
            return debt;
        }
    }

    async findByCustomerId(customerId: string): Promise<Debt[]> {
        return await db.debts.find({ customerId }) as Debt[];
    }

    async findBySubscriptionId(subscriptionId: string): Promise<Debt[]> {
        return await db.debts.find({ subscriptionId }) as Debt[];
    }
}

export class DebtRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteDebtRepository() : new NeDBDebtRepository();
    }
    async findBySubscriptionIdAndMonth(subscriptionId: string, monthStart: Date, monthEnd: Date): Promise<Debt[]> { return this.impl.findBySubscriptionIdAndMonth(subscriptionId, monthStart, monthEnd); }
    async findById(id: string): Promise<Debt | undefined> { return this.impl.findById(id); }
    async save(debt: Debt): Promise<Debt> { return this.impl.save(debt); }
    async findByCustomerId(customerId: string): Promise<Debt[]> { return this.impl.findByCustomerId(customerId); }
    async findBySubscriptionId(subscriptionId: string): Promise<Debt[]> { return this.impl.findBySubscriptionId(subscriptionId); }
}
