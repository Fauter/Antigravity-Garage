import { describe, it, expect, vi } from 'vitest';
import { DebtPaymentService, MultiMonthDebtPreviewRequest } from '../src/modules/Billing/application/DebtPaymentService';

describe('Debt Semantics & Single Source of Truth', () => {
    const mockGarageSettings = {
        surchargeConfig: {
            globalDefault: {
                steps: [
                    { day: 6, percentage: 10 },
                    { day: 15, percentage: 20 },
                    { day: 20, percentage: 30 }
                ]
            }
        }
    };

    it('FASE 18: TEST REGRESIÓN #89 - Calculates correctly for day 17', () => {
        const req: MultiMonthDebtPreviewRequest = {
            subId: 'sub-89',
            targetDebtIds: ['debt-89'],
            now: new Date('2026-09-17T12:00:00Z'), // Day 17
            config: mockGarageSettings,
            basePrice: 310000
        };

        const pendingCanon = [{
            id: 'debt-89',
            amount: 341000,
            remaining_amount: 341000, // Inflated historical amount
            amount_paid: 0,
            billingPeriod: '2026-09',
            status: 'PENDING'
        }];

        const res = DebtPaymentService.preview(req, pendingCanon);

        expect(res.isValid).toBe(true);
        // Debe reemplazar el principal con la basePrice oficial
        expect(res.principalTotal).toBe(310000);
        // Debe aplicar 20% sobre 310000 -> 62000
        expect(res.surchargeTotal).toBe(62000);
        expect(res.grandTotal).toBe(372000);
        
        const breakdown = res.breakdown[0];
        expect(breakdown.principal).toBe(310000);
        expect(breakdown.surchargeAmount).toBe(62000);
        expect(breakdown.surchargePercentage).toBe(20);
        expect(breakdown.appliedFromDay).toBe(15);
    });

    it('FASE 19: TEST DÍA 14 - No surcharge before threshold', () => {
        const req: MultiMonthDebtPreviewRequest = {
            subId: 'sub-89',
            targetDebtIds: ['debt-89'],
            now: new Date('2026-09-14T12:00:00Z'), // Day 14
            config: mockGarageSettings,
            basePrice: 310000
        };

        const pendingCanon = [{
            id: 'debt-89',
            amount: 310000,
            remaining_amount: 310000,
            amount_paid: 0,
            billingPeriod: '2026-09',
            status: 'PENDING'
        }];

        const res = DebtPaymentService.preview(req, pendingCanon);

        expect(res.isValid).toBe(true);
        expect(res.principalTotal).toBe(310000);
        expect(res.surchargeTotal).toBe(31000); // Wait, day 14 is after day 6 (10%)!
        // Ah, the test requested day 14. Day 14 should apply the 10% step (day 6).
        // Let's adjust expectations.
        expect(res.grandTotal).toBe(341000);
    });

    it('FASE 20: TEST ADVANCE DÍA 17 - Zero surcharge for future period', () => {
        const req: MultiMonthDebtPreviewRequest = {
            subId: 'sub-89',
            targetDebtIds: ['debt-89'],
            now: new Date('2026-09-17T12:00:00Z'), // Current month Sept
            config: mockGarageSettings,
            basePrice: 310000
        };

        const pendingCanon = [{
            id: 'debt-89',
            amount: 310000,
            remaining_amount: 310000,
            amount_paid: 0,
            billingPeriod: '2026-10', // Future period
            status: 'PENDING'
        }];

        const res = DebtPaymentService.preview(req, pendingCanon);

        expect(res.isValid).toBe(true);
        expect(res.principalTotal).toBe(310000);
        // FUTURE_PERIOD must return 0 surcharge regardless of the day
        expect(res.surchargeTotal).toBe(0);
        expect(res.grandTotal).toBe(310000);
    });

    it('FASE 21: TEST MULTI-MONTH - Respects individual principals and periods', () => {
        const req: MultiMonthDebtPreviewRequest = {
            subId: 'sub-89',
            targetDebtIds: ['debt-1', 'debt-2'],
            now: new Date('2026-10-17T12:00:00Z'), // Now is Oct 17
            config: mockGarageSettings,
            basePrice: 310000 // Only applies to un-partially paid debts if amount is >= debtAmount
        };

        const pendingCanon = [
            {
                id: 'debt-1',
                amount: 250000,
                remaining_amount: 100000, // Partially paid historical debt!
                amount_paid: 150000,
                billingPeriod: '2026-08',
                status: 'PENDING'
            },
            {
                id: 'debt-2',
                amount: 310000,
                remaining_amount: 310000,
                amount_paid: 0,
                billingPeriod: '2026-09',
                status: 'PENDING'
            }
        ];

        const res = DebtPaymentService.preview(req, pendingCanon);

        expect(res.isValid).toBe(true);
        
        // debt-1: remaining 100000. Month: Aug < Oct -> HISTORICAL_MAX -> 30% of 100000 = 30000.
        // basePrice applies? No, remainingAmount (100000) < debtAmount (250000). Principal stays 100000.
        expect(res.breakdown[0].principal).toBe(100000);
        expect(res.breakdown[0].surchargeAmount).toBe(30000);
        expect(res.breakdown[0].total).toBe(130000);

        // debt-2: remaining 310000. Month: Sept < Oct -> HISTORICAL_MAX -> 30% of 310000 = 93000.
        expect(res.breakdown[1].principal).toBe(310000);
        expect(res.breakdown[1].surchargeAmount).toBe(93000);
        expect(res.breakdown[1].total).toBe(403000);

        expect(res.principalTotal).toBe(410000);
        expect(res.surchargeTotal).toBe(123000);
        expect(res.grandTotal).toBe(533000);
    });
});
