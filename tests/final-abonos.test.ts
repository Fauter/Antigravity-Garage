import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebtPaymentService } from '../src/modules/Billing/application/DebtPaymentService';
import { PricingEngine } from '../src/modules/Billing/domain/PricingEngine';

describe('Final Abonos Hotfix Tests', () => {

    it('debt-preview-payment-method: should apply basePrice to virgin debts', () => {
        const canonicalPendingDebts = [
            {
                id: 'debt-1',
                type: 'CANON',
                amount: 1000,
                remaining_amount: 1000,
                status: 'PENDING',
                billingPeriod: '2026-06'
            }
        ];

        const req = {
            subId: 'sub-1',
            targetDebtIds: ['debt-1'],
            now: new Date('2026-09-01T00:00:00Z'),
            config: {
                initial_tolerance: 10,
                fractionate_after: 0
            },
            basePrice: 1200 // Represents Electronic Pricing
        };

        const res = DebtPaymentService.preview(req, canonicalPendingDebts);
        
        expect(res.isValid).toBe(true);
        expect(res.breakdown[0].principal).toBe(1200);
        // And the surcharge should be calculated on 1200.
        // Wait, the surcharge calculation is mocked or real? It uses PricingEngine which is real.
        // Since config doesn't have surchargeConfig, surcharge will be 0.
        expect(res.breakdown[0].surchargeAmount).toBe(0);
        expect(res.principalTotal).toBe(1200);
        expect(res.grandTotal).toBe(1200);
    });

    it('debt-preview-payment-method: should NOT apply basePrice to partially paid debts', () => {
        const canonicalPendingDebts = [
            {
                id: 'debt-1',
                type: 'CANON',
                amount: 1000,
                remaining_amount: 500, // Partially paid
                status: 'PENDING',
                billingPeriod: '2026-06'
            }
        ];

        const req = {
            subId: 'sub-1',
            targetDebtIds: ['debt-1'],
            now: new Date('2026-09-01T00:00:00Z'),
            config: {
                initial_tolerance: 10,
                fractionate_after: 0
            },
            basePrice: 1200 // Represents Electronic Pricing
        };

        const res = DebtPaymentService.preview(req, canonicalPendingDebts);
        
        expect(res.isValid).toBe(true);
        expect(res.breakdown[0].principal).toBe(500); // Must keep remaining amount
        expect(res.principalTotal).toBe(500);
    });

    it('financial-config-runtime-shape: PricingEngine should handle surchargeConfig when correctly passed', () => {
        const config = {
            surchargeConfig: {
                global_default: {
                    steps: [
                        { day: 1, percentage: 10 },
                        { day: 15, percentage: 30 }
                    ]
                }
            }
        };

        const canonicalPendingDebts = [
            {
                id: 'debt-1',
                type: 'CANON',
                amount: 1000,
                remaining_amount: 1000,
                status: 'PENDING',
                billingPeriod: '2026-06'
            }
        ];

        const req = {
            subId: 'sub-1',
            targetDebtIds: ['debt-1'],
            now: new Date('2026-09-01T12:00:00Z'), // Sept 2026, debt is June -> Historic!
            config: config,
            basePrice: 1000
        };

        const res = DebtPaymentService.preview(req, canonicalPendingDebts);
        
        expect(res.isValid).toBe(true);
        expect(res.breakdown[0].surchargePercentage).toBe(30); // Max surcharge for historic
        expect(res.breakdown[0].surchargeAmount).toBe(300); // 30% of 1000
        expect(res.grandTotal).toBe(1300);
    });
});
