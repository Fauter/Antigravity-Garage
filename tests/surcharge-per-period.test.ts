import { describe, it, expect } from 'vitest';
import { PricingEngine } from '../src/modules/Billing/domain/PricingEngine';

describe('Surcharge per Period (FASE 4)', () => {

    const createConfig = (steps: {day: number, percentage: number}[]) => ({
        surchargeConfig: {
            global_default: { steps }
        }
    });

    const createMonthlyConfig = (monthIdx: number, steps: {day: number, percentage: number}[]) => ({
        surchargeConfig: {
            monthly_overrides: {
                [String(monthIdx)]: { steps }
            }
        }
    });

    it('TEST BÁSICO HISTÓRICO: max percentage', () => {
        const config = createConfig([
            { day: 6, percentage: 10 },
            { day: 15, percentage: 20 },
            { day: 20, percentage: 30 }
        ]);

        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 860000,
            billingPeriod: '2026-06',
            now: new Date('2026-09-01T12:00:00Z'), // Sept 1st
            config
        });

        expect(res.percentage).toBe(30);
        expect(res.amount).toBe(258000);
        expect(res.reason).toBe('HISTORICAL_MAX');
    });

    it('TEST AGOSTO: immediately previous month is historical', () => {
        const config = createConfig([{ day: 20, percentage: 30 }]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 860000,
            billingPeriod: '2026-08',
            now: new Date('2026-09-01T12:00:00Z'),
            config
        });

        expect(res.percentage).toBe(30);
        expect(res.reason).toBe('HISTORICAL_MAX');
    });

    it('TEST MES ACTUAL - DÍA 1', () => {
        const config = createConfig([
            { day: 6, percentage: 10 },
            { day: 15, percentage: 20 }
        ]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-09',
            now: new Date('2026-09-01T15:00:00Z'), // ART is 12:00 Sept 1st
            config
        });
        expect(res.percentage).toBe(0);
        expect(res.reason).toBe('CURRENT_PERIOD_STEP');
    });

    it('TEST MES ACTUAL - DÍA 6', () => {
        const config = createConfig([{ day: 6, percentage: 10 }]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-09',
            now: new Date('2026-09-06T15:00:00Z'), // Sept 6
            config
        });
        expect(res.percentage).toBe(10);
    });

    it('TEST MES ACTUAL - DÍA 15', () => {
        const config = createConfig([
            { day: 6, percentage: 10 },
            { day: 15, percentage: 20 }
        ]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-09',
            now: new Date('2026-09-15T15:00:00Z'),
            config
        });
        expect(res.percentage).toBe(20);
    });

    it('TEST FUTURO', () => {
        const config = createConfig([{ day: 6, percentage: 10 }]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-10',
            now: new Date('2026-09-15T15:00:00Z'),
            config
        });
        expect(res.percentage).toBe(0);
        expect(res.reason).toBe('FUTURE_PERIOD');
    });

    it('TEST CONFIG DISTINTA: does not hardcode 30%', () => {
        const config = createConfig([
            { day: 5, percentage: 5 },
            { day: 10, percentage: 15 },
            { day: 25, percentage: 25 }
        ]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-06',
            now: new Date('2026-09-15T15:00:00Z'),
            config
        });
        expect(res.percentage).toBe(25);
    });

    it('TEST STEPS DESORDENADOS: handles unsorted steps', () => {
        const config = createConfig([
            { day: 20, percentage: 30 },
            { day: 6, percentage: 10 },
            { day: 15, percentage: 20 }
        ]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-09',
            now: new Date('2026-09-17T15:00:00Z'),
            config
        });
        expect(res.percentage).toBe(20); // >= 15 but < 20
    });

    it('TEST CONFIG VACÍA / INVÁLIDA: safe fallback', () => {
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-06',
            now: new Date(),
            config: { surchargeConfig: { global_default: { steps: [] } } }
        });
        expect(res.percentage).toBe(0);
        
        const resInvalid = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-06',
            now: new Date(),
            config: { surchargeConfig: { global_default: { steps: [{ day: "invalid", percentage: "NaN" }] } } }
        });
        expect(resInvalid.percentage).toBe(0);
    });

    it('TEST TIMEZONE: near midnight UTC boundary', () => {
        // Sept 1st 02:30:00 UTC is Aug 31st 23:30:00 ART
        const now = new Date('2026-09-01T02:30:00Z');
        
        const config = createConfig([{ day: 6, percentage: 10 }]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-09', // September debt
            now, // Executed on Aug 31 local time
            config
        });
        
        // Since locally it is August, September debt is FUTURE!
        expect(res.reason).toBe('FUTURE_PERIOD');
        expect(res.percentage).toBe(0);
    });

    it('TEST YEAR BOUNDARY', () => {
        const config = createConfig([{ day: 10, percentage: 15 }]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-12',
            now: new Date('2027-01-15T15:00:00Z'),
            config
        });
        expect(res.reason).toBe('HISTORICAL_MAX');
        expect(res.percentage).toBe(15);
    });

    it('TEST PARTIAL BASE: Calculates over remaining amount', () => {
        const config = createConfig([{ day: 10, percentage: 30 }]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 560000, // Partial remaining amount
            billingPeriod: '2026-06',
            now: new Date('2026-09-15T15:00:00Z'),
            config
        });
        expect(res.amount).toBe(168000); // 30% of 560000
    });
    
    it('TEST MONTHLY OVERRIDES: Historical debt respects its own override', () => {
        // Jun is month index 5
        const config = createMonthlyConfig(5, [{ day: 5, percentage: 40 }]);
        const res = PricingEngine.calculateDebtSurcharge({
            baseAmount: 1000,
            billingPeriod: '2026-06',
            now: new Date('2026-09-15T15:00:00Z'),
            config
        });
        // Even though we are in Sept, it uses Jun's override!
        expect(res.percentage).toBe(40);
        expect(res.reason).toBe('HISTORICAL_MAX');
    });
});
