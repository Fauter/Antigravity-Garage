import { describe, it, expect } from 'vitest';
import { calculateInitialSubscriptionAmount } from './subscriptionPricing';

describe('calculateInitialSubscriptionAmount', () => {
    it('Caso 1: Desactivado', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 4, 12, 0, 0), // August 4, 2026
            fullPriceEnabled: false,
            fullPriceUntilDay: null
        });

        expect(result.daysInMonth).toBe(31);
        expect(result.remainingDays).toBe(28);
        expect(result.isFullMonthCharge).toBe(false);
        expect(result.totalInitial).toBe(207742);
    });

    it('Caso 2: Activado antes del límite', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 4, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: 10
        });

        expect(result.isFullMonthCharge).toBe(true);
        expect(result.totalInitial).toBe(230000);
    });

    it('Caso 3: Día exacto del límite', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 10, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: 10
        });

        expect(result.isFullMonthCharge).toBe(true);
        expect(result.totalInitial).toBe(230000);
    });

    it('Caso 4: Día posterior al límite', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 11, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: 10
        });

        expect(result.remainingDays).toBe(21);
        expect(result.isFullMonthCharge).toBe(false);
        expect(result.totalInitial).toBe(155806);
    });

    it('Caso 5: Enabled true y día null no rompe y prorratea', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 4, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: null
        });

        expect(result.isFullMonthCharge).toBe(false);
        expect(result.totalInitial).toBe(207742);
    });

    it('Caso 6: Día inválido 0 no rompe y prorratea', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 4, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: 0
        });

        expect(result.isFullMonthCharge).toBe(false);
        expect(result.totalInitial).toBe(207742);
    });

    it('Caso 7: Día inválido 32 no rompe y prorratea', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 4, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: 32
        });

        expect(result.isFullMonthCharge).toBe(false);
        expect(result.totalInitial).toBe(207742);
    });

    it('Caso 8: Día decimal no rompe y prorratea', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 4, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: 5.5
        });

        expect(result.isFullMonthCharge).toBe(false);
        expect(result.totalInitial).toBe(207742);
    });

    it('Caso 9: Precio cero', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 0,
            currentDate: new Date(2026, 7, 4, 12, 0, 0),
            fullPriceEnabled: true,
            fullPriceUntilDay: 10
        });

        expect(result.totalInitial).toBe(0);
        expect(result.isFullMonthCharge).toBe(true);
        expect(Number.isNaN(result.totalInitial)).toBe(false);
        expect(Number.isFinite(result.totalInitial)).toBe(true);
    });

    it('Caso 10: Febrero no bisiesto', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 200000,
            currentDate: new Date(2026, 1, 15, 12, 0, 0), // Feb 15, 2026
            fullPriceEnabled: false,
            fullPriceUntilDay: null
        });

        expect(result.daysInMonth).toBe(28);
        expect(result.remainingDays).toBe(14); // 28 - 15 + 1
        expect(result.totalInitial).toBe(Math.round(200000 / 28 * 14));
    });

    it('Caso 11: Febrero bisiesto', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 200000,
            currentDate: new Date(2024, 1, 15, 12, 0, 0), // Feb 15, 2024
            fullPriceEnabled: false,
            fullPriceUntilDay: null
        });

        expect(result.daysInMonth).toBe(29);
        expect(result.remainingDays).toBe(15); // 29 - 15 + 1
        expect(result.totalInitial).toBe(Math.round(200000 / 29 * 15));
    });

    it('Caso 12: Día 31 con untilDay 31', () => {
        const result = calculateInitialSubscriptionAmount({
            monthlyPrice: 230000,
            currentDate: new Date(2026, 7, 31, 12, 0, 0), // August 31
            fullPriceEnabled: true,
            fullPriceUntilDay: 31
        });

        expect(result.isFullMonthCharge).toBe(true);
        expect(result.totalInitial).toBe(230000);
    });
});
