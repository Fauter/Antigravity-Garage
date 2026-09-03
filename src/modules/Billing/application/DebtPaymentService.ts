import { PricingEngine } from '../domain/PricingEngine';
import { BillingPeriodHelper } from '../domain/BillingPeriodHelper';

export interface MultiMonthDebtPreviewRequest {
    subId: string;
    targetDebtIds: string[];
    now: Date;
    config: any;
    basePrice?: number;
}

export interface DebtBreakdown {
    debtId: string;
    billingPeriod: string;
    principal: number;
    surchargePercentage: number;
    surchargeAmount: number;
    total: number;
    statusBefore: string;
}

export interface MultiMonthDebtPreviewResponse {
    isValid: boolean;
    error?: string;
    principalTotal: number;
    surchargeTotal: number;
    grandTotal: number;
    breakdown: DebtBreakdown[];
    debtsToPay: any[];
}

export interface MultiMonthDebtExecuteRequest extends MultiMonthDebtPreviewRequest {
    customerId: string;
    garageId: string;
    paymentMethod: string;
    billingType: string;
    operator: string;
}

export class DebtPaymentService {
    private static getPeriod(debt: any): string {
        if (debt.billingPeriod) return debt.billingPeriod;
        try {
            debt.billingPeriod = BillingPeriodHelper.getLegacyBillingPeriod(debt);
            return debt.billingPeriod;
        } catch (e) {
            return '';
        }
    }

    /**
     * Validates that the selected debts correspond exactly to the oldest contiguous pending CANON debts.
     * Throws an error if the selection is invalid.
     */
    static validateOldestContinuousPrefix(selectedIds: string[], canonicalPendingDebts: any[]): void {
        if (!selectedIds || selectedIds.length === 0) {
            throw new Error('No target debts provided.');
        }

        // Ensure canonical debts are sorted ASC by billingPeriod
        const sortedPending = [...canonicalPendingDebts].sort((a, b) => this.getPeriod(a).localeCompare(this.getPeriod(b)));

        // Check if the selected IDs match exactly the first N pending debts
        for (let i = 0; i < selectedIds.length; i++) {
            if (i >= sortedPending.length) {
                throw new Error('More debts selected than available pending debts.');
            }
            if (selectedIds[i] !== sortedPending[i].id) {
                throw new Error(`Invalid debt selection prefix. Expected oldest pending debt ${sortedPending[i].id} (${this.getPeriod(sortedPending[i])}) at index ${i}, but got ${selectedIds[i]}. You cannot skip months.`);
            }
        }
    }

    /**
     * Preview calculation for paying N continuous months.
     * Does NOT mutate the database.
     */
    static preview(
        request: MultiMonthDebtPreviewRequest,
        canonicalPendingDebts: any[]
    ): MultiMonthDebtPreviewResponse {
        const { targetDebtIds, now, config, basePrice } = request;

        try {
            const sortedPending = [...canonicalPendingDebts].sort((a, b) => this.getPeriod(a).localeCompare(this.getPeriod(b)));
            
            // Validate prefix
            this.validateOldestContinuousPrefix(targetDebtIds, sortedPending);

            const breakdown: DebtBreakdown[] = [];
            let principalTotal = 0;
            let surchargeTotal = 0;
            let grandTotal = 0;

            const debtsToPay = sortedPending.slice(0, targetDebtIds.length);

            for (const debt of debtsToPay) {
                const debtAmount = debt.amount ?? 0;
                let remainingAmount = debt.remaining_amount ?? debt.remainingAmount ?? debtAmount;
                
                let principal = remainingAmount;
                
                // Si la deuda es "virgen" (no tiene pagos parciales) y tenemos un basePrice resuelto
                // usamos el basePrice (que contempla Efectivo vs Transferencia)
                if (remainingAmount >= debtAmount && basePrice && basePrice > 0) {
                    principal = basePrice;
                }

                if (principal <= 0) {
                    throw new Error(`Debt ${debt.id} has no remaining principal.`);
                }

                const period = this.getPeriod(debt);
                const surchargeRes = PricingEngine.calculateDebtSurcharge({
                    baseAmount: principal,
                    billingPeriod: period,
                    now,
                    config
                });

                const total = principal + surchargeRes.amount;

                breakdown.push({
                    debtId: debt.id,
                    billingPeriod: period,
                    principal,
                    surchargePercentage: surchargeRes.percentage,
                    surchargeAmount: surchargeRes.amount,
                    total,
                    statusBefore: debt.status
                });

                principalTotal += principal;
                surchargeTotal += surchargeRes.amount;
                grandTotal += total;
            }

            return {
                isValid: true,
                principalTotal,
                surchargeTotal,
                grandTotal,
                breakdown,
                debtsToPay
            };
        } catch (error: any) {
            return {
                isValid: false,
                error: error.message,
                principalTotal: 0,
                surchargeTotal: 0,
                grandTotal: 0,
                breakdown: [],
                debtsToPay: []
            };
        }
    }

    /**
     * Calculates the new contiguous paid coverage endDate for a subscription.
     * Never moves the endDate backward.
     */
    static calculateContiguousPaidCoverage(
        currentEndDate: Date,
        allCanonDebts: any[]
    ): Date {
        // Sort all CANON debts by billingPeriod ASC
        const sortedCanon = [...allCanonDebts].sort((a, b) => this.getPeriod(a).localeCompare(this.getPeriod(b)));
        
        let latestPaidPeriodStr: string | null = null;
        
        // Find contiguous paid streak starting from the beginning
        for (const debt of sortedCanon) {
            if (debt.status === 'PAID') {
                latestPaidPeriodStr = this.getPeriod(debt);
            } else {
                // Gap found, stop streak
                break;
            }
        }

        if (!latestPaidPeriodStr) {
            return currentEndDate; // No streak, coverage remains unchanged
        }

        const [yearStr, monthStr] = latestPaidPeriodStr.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        // The end of the month in UTC to be stored
        // Last day of the month
        const lastDay = new Date(year, month, 0).getDate();
        
        // Generate UTC Date for the last day of the month at 23:59:59
        const proposedEndDate = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999));

        if (proposedEndDate > currentEndDate) {
            return proposedEndDate;
        }

        return currentEndDate;
    }
}
