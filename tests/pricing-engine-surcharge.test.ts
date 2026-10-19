import { describe, it, expect } from 'vitest';
import { PricingEngine } from '../src/modules/Billing/domain/PricingEngine';

describe('PricingEngine - Surcharge Calculation', () => {
    it('calculates correct surcharge using camelCase config (globalDefault)', () => {
        const config = {
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

        const result = PricingEngine.calculateDebtSurcharge({
            baseAmount: 310000,
            billingPeriod: '2026-09',
            now: new Date('2026-09-17T12:00:00Z'),
            config
        });

        // Día 17 -> Step de 15 días (20%)
        expect(result.percentage).toBe(20);
        expect(result.amount).toBe(62000); // 310000 * 0.20
    });

    it('calculates correct surcharge using camelCase config (monthlyOverrides)', () => {
        const config = {
            surchargeConfig: {
                globalDefault: {
                    steps: [
                        { day: 6, percentage: 10 }
                    ]
                },
                monthlyOverrides: {
                    '8': { // September is index 8
                        steps: [
                            { day: 6, percentage: 15 },
                            { day: 15, percentage: 25 }
                        ]
                    }
                }
            }
        };

        const result = PricingEngine.calculateDebtSurcharge({
            baseAmount: 310000,
            billingPeriod: '2026-09',
            now: new Date('2026-09-17T12:00:00Z'),
            config
        });

        // Día 17 -> Step de 15 días del monthlyOverrides de Septiembre (25%)
        expect(result.percentage).toBe(25);
        expect(result.amount).toBe(77500); // 310000 * 0.25
    });

    it('returns 0 for FUTURE_PERIOD (ADVANCE equivalent)', () => {
        const config = {
            surchargeConfig: {
                globalDefault: {
                    steps: [
                        { day: 1, percentage: 10 }
                    ]
                }
            }
        };

        const result = PricingEngine.calculateDebtSurcharge({
            baseAmount: 310000,
            billingPeriod: '2026-10', // Próximo mes
            now: new Date('2026-09-17T12:00:00Z'), // Mes actual
            config
        });

        expect(result.percentage).toBe(0);
        expect(result.amount).toBe(0);
        expect(result.reason).toBe('FUTURE_PERIOD');
    });
});
