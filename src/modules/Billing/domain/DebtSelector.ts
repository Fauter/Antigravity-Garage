import { Debt } from '../../../shared/schemas';
import { BillingPeriodHelper } from './BillingPeriodHelper';

export class DebtSelector {
    
    /**
     * FASE 3: CONCEPTO DE BILLING PERIOD
     * Normalizes a Date or debt object into a logical period key (YYYY-MM).
     * Two boundaries differing by 1 ms (e.g. 02:59:59.999Z vs 03:00:00.000Z)
     * must resolve to the same period.
     */
    public static getBillingPeriodKey(debtOrDate: any): string {
        let d: Date;
        if (debtOrDate instanceof Date) {
            d = debtOrDate;
        } else if (typeof debtOrDate === 'string' || typeof debtOrDate === 'number') {
            d = new Date(debtOrDate);
        } else if (debtOrDate.dueDate) {
            d = new Date(debtOrDate.dueDate);
        } else if (debtOrDate.due_date) {
            d = new Date(debtOrDate.due_date);
        } else if (debtOrDate.billingPeriod) {
            // Reconstruct a date from YYYY-MM
            const [year, month] = debtOrDate.billingPeriod.split('-');
            d = new Date(Date.UTC(Number(year), Number(month) - 1, 1, 3, 0, 0, 0));
        } else {
            throw new Error('Cannot extract billing period key from input: ' + JSON.stringify(debtOrDate));
        }

        // 02:59:59.999Z + 1ms = 03:00:00.000Z
        const normalizedDate = new Date(d.getTime() + 1);

        return BillingPeriodHelper.getBillingPeriod(normalizedDate);
    }

    /**
     * FASE 2: UNA ÚNICA DEFINICIÓN DE "DEBT CANON VÁLIDA"
     * Centralized abstraction for selecting valid PENDING CANON debts.
     */
    public static getPendingCanonDebtsForSubscription(
        allDebts: any[],
        garageId: string,
        subscriptionId: string
    ): any[] {
        if (!garageId) throw new Error('garageId is required');
        if (!subscriptionId) throw new Error('subscriptionId is required');

        return allDebts
            .filter(d => 
                d.subscriptionId === subscriptionId &&
                (d.garageId === garageId || (d as any).garage_id === garageId) && 
                d.type === 'CANON' &&
                d.status === 'PENDING' &&
                ((d.remaining_amount ?? d.remainingAmount ?? d.amount) > 0)
            )
            .sort((a, b) => {
                const keyA = this.getBillingPeriodKey(a);
                const keyB = this.getBillingPeriodKey(b);
                return keyA.localeCompare(keyB);
            });
    }
    
    public static getAllCanonDebtsForSubscription(
        allDebts: any[],
        garageId: string,
        subscriptionId: string
    ): any[] {
        if (!garageId) throw new Error('garageId is required');
        if (!subscriptionId) throw new Error('subscriptionId is required');

        return allDebts
            .filter(d => 
                d.subscriptionId === subscriptionId &&
                (d.garageId === garageId || (d as any).garage_id === garageId) && 
                d.type === 'CANON'
            )
            .sort((a, b) => {
                const keyA = this.getBillingPeriodKey(a);
                const keyB = this.getBillingPeriodKey(b);
                return keyA.localeCompare(keyB);
            });
    }
}
