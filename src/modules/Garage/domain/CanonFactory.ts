import { v5 as uuidv5 } from 'uuid';
import { Debt } from '../../../shared/schemas';

export class CanonFactory {
    public static readonly NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

    /**
     * Generates a deterministic logical ID for a CANON debt.
     * Guaranteed to be mathematically unique for a specific subscription + billing period.
     */
    public static getCanonicalId(subscriptionId: string, billingPeriod: string): string {
        const seedString = `CANON|${subscriptionId}|${billingPeriod}`;
        return uuidv5(seedString, this.NAMESPACE);
    }

    /**
     * Creates a normalized, canonical PENDING Debt object for a specific period.
     */
    public static createCanonDebt(
        subscriptionId: string,
        customerId: string,
        amount: number,
        billingPeriod: string,
        dueDate: Date
    ): Debt {
        return {
            id: this.getCanonicalId(subscriptionId, billingPeriod),
            subscriptionId,
            customerId,
            amount,
            remaining_amount: amount,
            amount_paid: 0,
            surchargeApplied: 0,
            status: 'PENDING',
            type: 'CANON',
            billingPeriod,
            dueDate,
            createdAt: new Date(),
            updatedAt: new Date()
        } as unknown as Debt; // Typecast because we add remainingAmount for JS side if needed, but schema uses remaining_amount
    }
}
