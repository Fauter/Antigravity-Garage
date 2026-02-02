import { describe, it, expect } from 'vitest';
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

    it('debe aplicar recargo por mora sobre precio base (Efectivo)', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(15); // Mora N1

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Efectivo'
        );
        // 8000 + 500
        expect(price).toBe(8500);
    });

    it('debe aplicar recargo por mora sobre precio diferenciado (Tarjeta)', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(15); // Mora N1

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Tarjeta'
        );
        // 8800 + 500
        expect(price).toBe(9300);
    });
});
