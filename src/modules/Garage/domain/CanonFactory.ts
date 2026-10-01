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
     * Generates the canonical due date for a given year and month (0-indexed).
     * Defines exactly the end of the previous month / start of the current month boundary.
     * Replaces duplicated logic.
     */
    public static getCanonDueDate(year: number, month: number): Date {
        // We use the traditional boundary: 23:59:59.999 of the last day of the previous month, local time.
        // E.g., for Sept 2026 (month=8), month is Sept. previous month is Aug.
        // Wait, month parameter here represents the month being billed!
        // If we are billing Sept 2026 (month 8, 0-indexed), the coverage is Sept 1 - Sept 30.
        // The due date is traditionally Aug 31 23:59:59.999.
        // So new Date(year, month, 0, 23, 59, 59, 999) gives the last day of the PREVIOUS month.
        return new Date(year, month, 0, 23, 59, 59, 999);
    }

    /**
     * Creates a normalized, canonical PENDING Debt object for a specific period.
     * FAILS FAST if garageId is missing.
     */
    public static createCanonDebt(
        subscriptionId: string,
        customerId: string,
        amount: number,
        billingPeriod: string,
        dueDate: Date,
        garageId: string
    ): Debt {
        if (!garageId || garageId === 'NULL') {
            throw new Error(`Cannot create CANON debt for subscription ${subscriptionId} without a valid garageId.`);
        }

        return {
            id: this.getCanonicalId(subscriptionId, billingPeriod),
            subscriptionId,
            customerId,
            garageId,
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
