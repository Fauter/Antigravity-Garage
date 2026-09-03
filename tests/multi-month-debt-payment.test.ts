import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebtPaymentService, MultiMonthDebtPreviewRequest } from '../src/modules/Billing/application/DebtPaymentService';

describe('Multi-Month DEBT Payment Backend (FASE 5)', () => {

    const now = new Date('2026-09-01T12:00:00Z');
    
    // config: 6->10%, 15->20%, 20->30%
    const config = {
        surchargeConfig: {
            global_default: {
                steps: [
                    { day: 6, percentage: 10 },
                    { day: 15, percentage: 20 },
                    { day: 20, percentage: 30 }
                ]
            }
        }
    };

    const mockDebts = [
        { id: 'd-may', billingPeriod: '2026-05', status: 'PENDING', amount: 860000, remainingAmount: 860000 },
        { id: 'd-jun', billingPeriod: '2026-06', status: 'PENDING', amount: 860000, remainingAmount: 860000 },
        { id: 'd-jul', billingPeriod: '2026-07', status: 'PENDING', amount: 860000, remainingAmount: 860000 },
        { id: 'd-aug', billingPeriod: '2026-08', status: 'PENDING', amount: 860000, remainingAmount: 860000 },
        { id: 'd-sep', billingPeriod: '2026-09', status: 'PENDING', amount: 860000, remainingAmount: 860000 }
    ];

    describe('validateOldestContinuousPrefix', () => {
        it('TEST — PREFIX VÁLIDO: allows oldest continuous prefix', () => {
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-may'], mockDebts)).not.toThrow();
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-may', 'd-jun'], mockDebts)).not.toThrow();
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-may', 'd-jun', 'd-jul'], mockDebts)).not.toThrow();
        });

        it('TEST — PREFIX INVÁLIDO: rejects non-contiguous or missing oldest', () => {
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-jun'], mockDebts)).toThrow(/Invalid debt selection prefix/);
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-may', 'd-jul'], mockDebts)).toThrow(/Invalid debt selection prefix/);
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-jul', 'd-aug'], mockDebts)).toThrow(/Invalid debt selection prefix/);
        });

        it('TEST — DUPLICATE TARGET ID', () => {
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-may', 'd-may'], mockDebts)).toThrow(/Invalid debt selection prefix/);
        });
        
        it('TEST — SKIP: fails if attempting to pay newer while old is pending', () => {
            expect(() => DebtPaymentService.validateOldestContinuousPrefix(['d-may', 'd-jul'], mockDebts)).toThrow(/Invalid debt selection prefix/);
        });
    });

    describe('preview (calculates logic per debt)', () => {
        it('TEST — 1 MES HISTÓRICO', () => {
            const req: MultiMonthDebtPreviewRequest = {
                subId: 'sub-1',
                targetDebtIds: ['d-may'],
                now,
                config
            };
            const res = DebtPaymentService.preview(req, mockDebts);

            expect(res.isValid).toBe(true);
            expect(res.principalTotal).toBe(860000);
            expect(res.surchargeTotal).toBe(258000); // 30% of 860000
            expect(res.grandTotal).toBe(1118000);
            expect(res.breakdown.length).toBe(1);
            expect(res.breakdown[0].principal).toBe(860000);
            expect(res.breakdown[0].surchargePercentage).toBe(30);
        });

        it('TEST — 3 MESES', () => {
            const req: MultiMonthDebtPreviewRequest = {
                subId: 'sub-1',
                targetDebtIds: ['d-may', 'd-jun', 'd-jul'],
                now,
                config
            };
            const res = DebtPaymentService.preview(req, mockDebts);

            expect(res.isValid).toBe(true);
            expect(res.principalTotal).toBe(860000 * 3); // 2,580,000
            expect(res.surchargeTotal).toBe(258000 * 3); // 774,000
            expect(res.grandTotal).toBe(3354000);
        });

        it('TEST — INCLUYE MES ACTUAL', () => {
            // Sept 1st -> Sept has 0% surcharge
            const req: MultiMonthDebtPreviewRequest = {
                subId: 'sub-1',
                targetDebtIds: ['d-may', 'd-jun', 'd-jul', 'd-aug', 'd-sep'],
                now,
                config
            };
            const res = DebtPaymentService.preview(req, mockDebts);

            expect(res.isValid).toBe(true);
            
            const sepBreakdown = res.breakdown.find(b => b.billingPeriod === '2026-09');
            expect(sepBreakdown?.surchargePercentage).toBe(0);
            expect(sepBreakdown?.surchargeAmount).toBe(0);

            expect(res.surchargeTotal).toBe(258000 * 4); // May, Jun, Jul, Aug
        });

        it('TEST — PARTIAL REMAINING', () => {
            const partialDebts = [
                { id: 'd-may', billingPeriod: '2026-05', status: 'PENDING', amount: 860000, remainingAmount: 560000 }
            ];
            
            const req: MultiMonthDebtPreviewRequest = {
                subId: 'sub-1',
                targetDebtIds: ['d-may'],
                now,
                config
            };
            const res = DebtPaymentService.preview(req, partialDebts);

            expect(res.isValid).toBe(true);
            expect(res.principalTotal).toBe(560000);
            expect(res.surchargeTotal).toBe(168000); // 30% of 560000
        });
    });

    describe('calculateContiguousPaidCoverage', () => {
        it('TEST — COVERAGE CONTIGUO', () => {
            const currentEndDate = new Date('2026-04-30T23:59:59Z');
            const canonDebts = [
                { billingPeriod: '2026-05', status: 'PAID' },
                { billingPeriod: '2026-06', status: 'PAID' },
                { billingPeriod: '2026-07', status: 'PAID' },
                { billingPeriod: '2026-08', status: 'PENDING' }
            ];
            const newEndDate = DebtPaymentService.calculateContiguousPaidCoverage(currentEndDate, canonDebts);
            
            expect(newEndDate.getFullYear()).toBe(2026);
            expect(newEndDate.getMonth()).toBe(6); // July (0-indexed)
            expect(newEndDate.getUTCDate()).toBe(31);
        });

        it('TEST — HUECO', () => {
            const currentEndDate = new Date('2026-04-30T23:59:59Z');
            const canonDebts = [
                { billingPeriod: '2026-05', status: 'PAID' },
                { billingPeriod: '2026-06', status: 'PENDING' },
                { billingPeriod: '2026-07', status: 'PAID' }
            ];
            const newEndDate = DebtPaymentService.calculateContiguousPaidCoverage(currentEndDate, canonDebts);
            
            // Should stop at May
            expect(newEndDate.getFullYear()).toBe(2026);
            expect(newEndDate.getMonth()).toBe(4); // May
            expect(newEndDate.getUTCDate()).toBe(31);
        });

        it('TEST — FEBRUARY', () => {
            const currentEndDate = new Date('2028-01-31T23:59:59Z');
            const canonDebts = [
                { billingPeriod: '2028-02', status: 'PAID' }
            ];
            const newEndDate = DebtPaymentService.calculateContiguousPaidCoverage(currentEndDate, canonDebts);
            
            expect(newEndDate.getFullYear()).toBe(2028);
            expect(newEndDate.getMonth()).toBe(1); // Feb
            expect(newEndDate.getUTCDate()).toBe(29); // Leap year
        });
        
        it('TEST — NO RETROCEDER COVERAGE', () => {
            // Already covered till Jun
            const currentEndDate = new Date('2026-06-30T23:59:59Z');
            // But only May is PAID in debts for some reason
            const canonDebts = [
                { billingPeriod: '2026-05', status: 'PAID' }
            ];
            const newEndDate = DebtPaymentService.calculateContiguousPaidCoverage(currentEndDate, canonDebts);
            
            // Must not regress
            expect(newEndDate.getTime()).toBe(currentEndDate.getTime());
        });
    });
});
