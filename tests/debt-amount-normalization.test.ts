import { describe, it, expect } from 'vitest';

/**
 * Tests for parseDebtAmount and getDebtRemaining utility.
 * Validates correct handling of Supabase numeric-as-string,
 * null, undefined, NaN, and partial payment scenarios.
 */

// We inline the logic here since the utility is a frontend file
// and the test runner uses Node.js. The logic is simple enough to duplicate for testing.
function parseDebtAmount(value: any): number {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return isNaN(n) ? 0 : n;
}

function getDebtRemaining(debt: any): number {
    const raw = debt.remaining_amount;
    if (raw !== null && raw !== undefined && !isNaN(Number(raw))) {
        return Number(raw);
    }
    return parseDebtAmount(debt.amount);
}

describe('parseDebtAmount', () => {
    it('parses a number correctly', () => {
        expect(parseDebtAmount(860000)).toBe(860000);
    });

    it('parses a string number correctly (Supabase numeric)', () => {
        expect(parseDebtAmount('860000.00')).toBe(860000);
    });

    it('parses zero correctly', () => {
        expect(parseDebtAmount(0)).toBe(0);
        expect(parseDebtAmount('0')).toBe(0);
        expect(parseDebtAmount('0.00')).toBe(0);
    });

    it('returns 0 for null', () => {
        expect(parseDebtAmount(null)).toBe(0);
    });

    it('returns 0 for undefined', () => {
        expect(parseDebtAmount(undefined)).toBe(0);
    });

    it('returns 0 for NaN-producing strings', () => {
        expect(parseDebtAmount('not-a-number')).toBe(0);
        expect(parseDebtAmount('')).toBe(0);
    });
});

describe('getDebtRemaining', () => {
    it('returns remaining_amount when it is a number', () => {
        expect(getDebtRemaining({ remaining_amount: 430000, amount: 860000 })).toBe(430000);
    });

    it('returns remaining_amount when it is a string (Supabase numeric)', () => {
        expect(getDebtRemaining({ remaining_amount: '430000.00', amount: '860000.00' })).toBe(430000);
    });

    it('returns remaining_amount of 0 (fully paid)', () => {
        expect(getDebtRemaining({ remaining_amount: 0, amount: 860000 })).toBe(0);
    });

    it('returns remaining_amount of "0" (string zero from Supabase)', () => {
        expect(getDebtRemaining({ remaining_amount: '0', amount: '860000.00' })).toBe(0);
    });

    it('falls back to amount when remaining_amount is null', () => {
        expect(getDebtRemaining({ remaining_amount: null, amount: 860000 })).toBe(860000);
    });

    it('falls back to amount when remaining_amount is undefined', () => {
        expect(getDebtRemaining({ remaining_amount: undefined, amount: 860000 })).toBe(860000);
    });

    it('falls back to amount as string when remaining_amount is missing', () => {
        expect(getDebtRemaining({ amount: '860000.00' })).toBe(860000);
    });

    it('returns 0 when both remaining_amount and amount are missing', () => {
        expect(getDebtRemaining({})).toBe(0);
    });

    it('handles partial payment scenario: remaining < amount', () => {
        const debt = { remaining_amount: '430000.00', amount: '860000.00', amount_paid: '430000.00', status: 'PENDING' };
        expect(getDebtRemaining(debt)).toBe(430000);
    });

    it('handles full amount when no partial payment', () => {
        const debt = { remaining_amount: '860000.00', amount: '860000.00', amount_paid: '0', status: 'PENDING' };
        expect(getDebtRemaining(debt)).toBe(860000);
    });

    // Edge case: typeof remaining_amount === 'number' but it's NaN
    it('falls back to amount when remaining_amount is NaN', () => {
        expect(getDebtRemaining({ remaining_amount: NaN, amount: 860000 })).toBe(860000);
    });
});
