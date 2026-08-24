import { describe, it, expect } from 'vitest';
import { getLastTwoDaysEligibility } from './dateEligibility';

describe('getLastTwoDaysEligibility', () => {
    it('Caso A: Enero 29 -> false', () => {
        const date = new Date(2026, 0, 29); // Meses en Date(year, month) son 0-index. 0 = Enero
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(false);
    });

    it('Caso B: Enero 30 -> true', () => {
        const date = new Date(2026, 0, 30);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso C: Enero 31 -> true', () => {
        const date = new Date(2026, 0, 31);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso D: Abril 28 -> false', () => {
        const date = new Date(2026, 3, 28);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(false);
    });

    it('Caso E: Abril 29 -> true', () => {
        const date = new Date(2026, 3, 29);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso F: Abril 30 -> true', () => {
        const date = new Date(2026, 3, 30);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso G: Febrero no bisiesto, 26 -> false', () => {
        const date = new Date(2026, 1, 26);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(false);
    });

    it('Caso H: Febrero no bisiesto, 27 -> true', () => {
        const date = new Date(2026, 1, 27);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso I: Febrero no bisiesto, 28 -> true', () => {
        const date = new Date(2026, 1, 28);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso J: Febrero bisiesto, 27 -> false', () => {
        const date = new Date(2024, 1, 27);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(false);
    });

    it('Caso K: Febrero bisiesto, 28 -> true', () => {
        const date = new Date(2024, 1, 28);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso L: Febrero bisiesto, 29 -> true', () => {
        const date = new Date(2024, 1, 29);
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(true);
    });

    it('Caso M: Fecha inválida -> false', () => {
        const date = new Date('invalid_date');
        const result = getLastTwoDaysEligibility(date);
        expect(result.isLastTwoDays).toBe(false);
    });

    it('Caso N: Cambio de año, 30 y 31 de Diciembre -> true', () => {
        const date30 = new Date(2026, 11, 30);
        const result30 = getLastTwoDaysEligibility(date30);
        expect(result30.isLastTwoDays).toBe(true);

        const date31 = new Date(2026, 11, 31);
        const result31 = getLastTwoDaysEligibility(date31);
        expect(result31.isLastTwoDays).toBe(true);
    });
});
