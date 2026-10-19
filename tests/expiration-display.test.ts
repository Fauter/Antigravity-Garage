import { describe, it, expect } from 'vitest';

/**
 * Tests for expiration display logic.
 * Validates that isSubscriptionExpired works correctly
 * and that the visual state resolver handles all edge cases.
 */

// Import from source  
import { isSubscriptionExpired } from '../src/frontend/src/components/subscription/CustomerDetailView';
import { resolveSubscriptionVisualState } from '../src/frontend/src/utils/subscriptionHelper';

describe('isSubscriptionExpired', () => {
    it('returns true when endDate is in the past', () => {
        const sub = { endDate: '2026-08-31T23:59:59.999Z' };
        expect(isSubscriptionExpired(sub)).toBe(true);
    });

    it('returns false when endDate is in the future', () => {
        const now = new Date();
        const futureDate = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
        const sub = { endDate: futureDate.toISOString() };
        expect(isSubscriptionExpired(sub)).toBe(false);
    });

    it('handles end_date (snake_case) field', () => {
        const sub = { end_date: '2026-08-31T23:59:59.999Z' };
        expect(isSubscriptionExpired(sub)).toBe(true);
    });

    it('calculates from startDate when endDate is missing', () => {
        // startDate in January 2026 — end of month is Jan 31
        const sub = { startDate: '2026-01-01T00:00:00.000Z' };
        expect(isSubscriptionExpired(sub)).toBe(true); // Jan 2026 is definitely past
    });

    it('returns false when subscription is null', () => {
        expect(isSubscriptionExpired(null)).toBe(false);
    });

    it('returns false when no date fields exist', () => {
        expect(isSubscriptionExpired({ id: 'no-dates' })).toBe(false);
    });

    it('active=true + expired endDate = expired (moroso but active)', () => {
        const sub = {
            id: 'sub-moroso',
            active: true,
            endDate: '2026-08-31T23:59:59.999Z'
        };
        // isSubscriptionExpired only checks dates, not active flag
        expect(isSubscriptionExpired(sub)).toBe(true);
        // The subscription is still active (relationship) but the coverage is expired (moroso)
        expect(sub.active).toBe(true);
    });
});

describe('resolveSubscriptionVisualState', () => {
    const now = new Date();
    
    it('returns DEBT_PENDING when there are pending CANON debts', () => {
        const sub = {
            id: 'sub-001',
            active: true,
            endDate: '2026-08-31T23:59:59.999Z' // expired
        };
        const debts = [
            { subscriptionId: 'sub-001', type: 'CANON', status: 'PENDING', remaining_amount: 860000, amount: 860000 }
        ];
        const result = resolveSubscriptionVisualState(sub, debts, now);
        expect(result).toBe('DEBT_PENDING');
    });

    it('returns INCONSISTENT when expired without pending debts', () => {
        const sub = {
            id: 'sub-001',
            active: true,
            endDate: '2026-08-31T23:59:59.999Z' // expired
        };
        const debts: any[] = []; // no debts
        const result = resolveSubscriptionVisualState(sub, debts, now);
        expect(result).toBe('INCONSISTENT');
    });

    it('returns EXPIRED when subscription is inactive', () => {
        const sub = {
            id: 'sub-001',
            active: false,
            endDate: '2026-08-31T23:59:59.999Z'
        };
        const result = resolveSubscriptionVisualState(sub, [], now);
        expect(result).toBe('EXPIRED');
    });

    it('returns EXPIRED when endDate is missing', () => {
        const sub = {
            id: 'sub-001',
            active: true,
            endDate: undefined
        };
        const result = resolveSubscriptionVisualState(sub, [], now);
        expect(result).toBe('EXPIRED');
    });

    it('does not return DEBT_PENDING for PAID debts', () => {
        const futureDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const sub = {
            id: 'sub-001',
            active: true,
            endDate: futureDate.toISOString()
        };
        const debts = [
            { subscriptionId: 'sub-001', type: 'CANON', status: 'PAID', remaining_amount: 0, amount: 860000 }
        ];
        const result = resolveSubscriptionVisualState(sub, debts, now);
        expect(result).not.toBe('DEBT_PENDING');
    });

    it('subscription vencida sin debt → INCONSISTENT (debe mostrar vencimiento)', () => {
        const sub = {
            id: 'sub-inconsistent',
            active: true,
            endDate: '2026-07-31T23:59:59.999Z' // very expired
        };
        const result = resolveSubscriptionVisualState(sub, [], now);
        expect(result).toBe('INCONSISTENT');
        // This scenario should still show vencimiento in the UI, not hide it
    });
});
