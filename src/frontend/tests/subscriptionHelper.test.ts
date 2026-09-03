import { describe, it, expect } from 'vitest';
import { getAdvanceEligibility, resolveSubscriptionForCochera } from '../src/utils/subscriptionHelper';

describe('subscriptionHelper', () => {
    describe('resolveSubscriptionForCochera', () => {
        it('matches by spotNumber securely', () => {
            const cochera = { numero: '134', clienteId: 'c1' };
            const subs = [{ id: 's1', spotNumber: '134', customerId: 'c1', active: true }];
            const res = resolveSubscriptionForCochera(cochera, subs, []);
            expect(res.matchType).toBe('SPOT');
            expect(res.isSafeForFinancialOperation).toBe(true);
            expect(res.subscription.id).toBe('s1');
        });

        it('returns AMBIGUOUS when fallback type matches multiple', () => {
            const cochera = { tipo: 'Fija', clienteId: 'c1' };
            const subs = [
                { id: 's1', type: 'Fija', customerId: 'c1', active: true },
                { id: 's2', type: 'Fija', customerId: 'c1', active: true }
            ];
            const res = resolveSubscriptionForCochera(cochera, subs, []);
            expect(res.matchType).toBe('AMBIGUOUS');
            expect(res.isSafeForFinancialOperation).toBe(false);
            expect(res.subscription).toBeNull();
        });
    });

    describe('getAdvanceEligibility', () => {
        it('Caso 1: endDate 31/08 (today 01/09) -> false (EXPIRED)', () => {
            const sub = { id: 's1', active: true, endDate: '2026-08-31T23:59:59Z' };
            const now = new Date('2026-09-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, [], true, now);
            expect(res.eligible).toBe(false);
            expect(res.reason).toBe('EXPIRED');
        });

        it('Caso 2: endDate 30/09 (today 01/09) -> true, Octubre', () => {
            const sub = { id: 's1', active: true, endDate: '2026-09-30T23:59:59Z' };
            const now = new Date('2026-09-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, [], true, now);
            expect(res.eligible).toBe(true);
            expect(res.nextMonthLabel).toBe('Octubre');
        });

        it('Caso 3: endDate 31/10 (today 01/09) -> false (NOT_CURRENT_MONTH_END)', () => {
            const sub = { id: 's1', active: true, endDate: '2026-10-31T23:59:59Z' };
            const now = new Date('2026-09-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, [], true, now);
            expect(res.eligible).toBe(false);
            expect(res.reason).toBe('NOT_CURRENT_MONTH_END');
        });

        it('Caso 4: 30/09 + CANON pendiente -> false', () => {
            const sub = { id: 's1', active: true, endDate: '2026-09-30T23:59:59Z' };
            const debts = [{ subscriptionId: 's1', status: 'PENDING', type: 'CANON' }];
            const now = new Date('2026-09-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, debts, true, now);
            expect(res.eligible).toBe(false);
            expect(res.reason).toBe('PENDING_DEBTS');
        });

        it('Caso 5: 30/09 + identity ambiguous -> false', () => {
            const sub = { id: 's1', active: true, endDate: '2026-09-30T23:59:59Z' };
            const now = new Date('2026-09-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, [], false, now);
            expect(res.eligible).toBe(false);
            expect(res.reason).toBe('AMBIGUOUS_MATCH');
        });

        it('Caso 6: 30/09 + inactive -> false', () => {
            const sub = { id: 's1', active: false, endDate: '2026-09-30T23:59:59Z' };
            const now = new Date('2026-09-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, [], true, now);
            expect(res.eligible).toBe(false);
            expect(res.reason).toBe('INACTIVE');
        });

        it('TEST CAMBIO DE AÑO: endDate 31/12/2026 (today 01/12/2026) -> Enero', () => {
            const sub = { id: 's1', active: true, endDate: '2026-12-31T23:59:59Z' };
            const now = new Date('2026-12-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, [], true, now);
            expect(res.eligible).toBe(true);
            expect(res.nextMonthLabel).toBe('Enero');
        });

        it('TEST FEBRERO: endDate 31/01/2028 (today 01/01/2028) -> Febrero', () => {
            const sub = { id: 's1', active: true, endDate: '2028-01-31T23:59:59Z' };
            const now = new Date('2028-01-01T12:00:00Z');
            const res = getAdvanceEligibility(sub, [], true, now);
            expect(res.eligible).toBe(true);
            expect(res.nextMonthLabel).toBe('Febrero');
        });
    });
});
