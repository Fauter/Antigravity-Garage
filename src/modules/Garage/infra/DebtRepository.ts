import { Debt } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';

export class DebtRepository {
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
            // IDEMPOTENCY DEEP CHECK: Prevent infinite loop of identical updates
            if (existingDebt.amount === debt.amount && existingDebt.status === debt.status) {
                // If the critical fields haven't changed, ignore the save and don't queue.
                return existingDebt;
            }

            await db.debts.update({ id: debt.id }, { $set: debt }, { multi: false });
            // Fetch updated to ensure correct data
            const updated = await db.debts.findOne({ id: debt.id }) as Debt;

            // Emit queue mutation to Supabase ONLY if it actually changed
            await this.queue.enqueue('Debt', 'UPDATE', updated);
            return updated;
        } else {
            // Note: NeDB auto-generates _id, but we keep 'id' as our primary
            await db.debts.insert(debt);
            // Emit queue mutation to Supabase
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
