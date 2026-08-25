import { describe, expect, it, vi, afterEach } from 'vitest';
import { PricingEngine } from '../src/modules/Billing/domain/PricingEngine';

describe('Simulated Time-Travel Test (Deudas Y Recargos)', () => {
    const baseAmount = 40000;
    const config = {
        apartirdia11: 10,  
        apartirdia22: 20   
    };

    afterEach(() => {
        vi.useRealTimers();
    });

    it('Escenario A (Día 5) pasó: Sin recargo ($0)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-05T12:00:00Z'));
        const surcharge = PricingEngine.calculateSurcharge(baseAmount, config);
        expect(surcharge).toBe(0);
    });

    it('Escenario B (Día 15) pasó: Recargo 10% ($4000)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
        const surcharge = PricingEngine.calculateSurcharge(baseAmount, config);
        expect(surcharge).toBe(4000);
    });

    it('Escenario C (Día 25) pasó: Recargo 20% ($8000)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-25T12:00:00Z'));
        const surcharge = PricingEngine.calculateSurcharge(baseAmount, config);
        expect(surcharge).toBe(8000);
    });
});
