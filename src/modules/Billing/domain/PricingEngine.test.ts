import { describe, expect, it, vi } from 'vitest';
import { PricingEngine, TarifasConfig } from './PricingEngine';
import { SubscriptionType } from '../../../shared/schemas';

describe('PricingEngine', () => {
    const mockConfig: TarifasConfig = {
        mensual: {
            Exclusiva: { Efectivo: 10000, Tarjeta: 11000 },
            Fija: { Efectivo: 8000, Tarjeta: 8800 },
            Movil: { Efectivo: 5000, Tarjeta: 5500 },
        },
        mora: {
            nivel1: 500,
            nivel2: 1000,
        },
    };

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const dateOn = (day: number) => new Date(currentYear, currentMonth, day);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

    it('debe calcular cobro normal en Efectivo', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(5);

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Efectivo'
        );
        expect(price).toBe(8000);
    });

    it('debe calcular cobro diferenciado con Tarjeta', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(5);

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Tarjeta'
        );
        expect(price).toBe(8800);
    });

    it('debe aplicar recargo por mora explícito (Efectivo)', () => {
        const basePrice = mockConfig.mensual.Fija.Efectivo; // 8000
        const mockSurchargeConfig = { surchargeConfig: { global_default: { steps: [{ day: 10, percentage: 5 }] } } };
        // Simulate 'today' is 15th
        vi.setSystemTime(new Date(2023, 7, 15));
        const surcharge = PricingEngine.calculateSurcharge(basePrice, mockSurchargeConfig);
        expect(surcharge).toBe(400); // 5% of 8000
        vi.useRealTimers();
    });

    it('debe calcular correctamente cuota mensual base sin mora incrustada (Tarjeta)', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(15); 

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Tarjeta'
        );
        // Should be 8800 without surcharge
        expect(price).toBe(8800);
    });
});
