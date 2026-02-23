import { Debt } from '../../../shared/schemas';
import { JsonDB } from '../../../infrastructure/database/json-db';

const debtsDB = new JsonDB<Debt>('debts');

export class DebtRepository {
    async findBySubscriptionIdAndMonth(subscriptionId: string, monthStart: Date, monthEnd: Date): Promise<Debt[]> {
        const allDebts = await debtsDB.getAll();
        return allDebts.filter(d => {
            if (d.subscriptionId !== subscriptionId) return false;
            const dueDate = new Date(d.dueDate);
            return dueDate >= monthStart && dueDate <= monthEnd;
        });
    }

    async save(debt: Debt): Promise<Debt> {
        let allDebts = await debtsDB.getAll();
        const existingIndex = allDebts.findIndex(d => d.id === debt.id);

        if (existingIndex >= 0) {
            await debtsDB.updateOne({ id: debt.id } as Partial<Debt>, debt);
            return debt;
        } else {
            return await debtsDB.create(debt);
        }
    }

    async findByCustomerId(customerId: string): Promise<Debt[]> {
        const allDebts = await debtsDB.getAll();
        return allDebts.filter(d => d.customerId === customerId);
    }
}
