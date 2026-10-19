import { describe, it, expect } from 'vitest';
import { 
    getAdvanceEligibility, 
    resolveSubscriptionForCochera, 
    isSubscriptionExpired, 
    hasCustomerExpiredSubscription,
    calculateCustomerBalance 
} from '../src/utils/subscriptionHelper';

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

    describe('isSubscriptionExpired', () => {
        it('returns true when endDate is in the past', () => {
            const sub = { id: 's1', endDate: '2026-09-30T23:59:59Z' };
            const now = new Date('2026-10-19T18:00:00Z');
            expect(isSubscriptionExpired(sub, now)).toBe(true);
        });

        it('returns false when endDate is in the future', () => {
            const sub = { id: 's1', endDate: '2026-10-31T23:59:59Z' };
            const now = new Date('2026-10-19T18:00:00Z');
            expect(isSubscriptionExpired(sub, now)).toBe(false);
        });

        it('supports snake_case end_date', () => {
            const sub = { id: 's1', end_date: '2026-09-30T23:59:59Z' };
            const now = new Date('2026-10-19T18:00:00Z');
            expect(isSubscriptionExpired(sub, now)).toBe(true);
        });

        it('returns false when no date field exists', () => {
            expect(isSubscriptionExpired({})).toBe(false);
            expect(isSubscriptionExpired(null)).toBe(false);
        });
    });

    describe('hasCustomerExpiredSubscription', () => {
        it('detects Eugenio Triciclo case: spot #75 expired 30/09/2026 -> true', () => {
            const clientCocheras = [
                { id: 'coch-75', numero: '75', tipo: 'Fija', precioBase: 860000, clienteId: 'c-eugenio', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-75', spotNumber: '75', type: 'Fija', customerId: 'c-eugenio', endDate: '2026-09-30T23:59:59Z', active: true }
            ];
            const now = new Date('2026-10-19T18:00:00Z');
            const expired = hasCustomerExpiredSubscription(clientCocheras, clientSubscriptions, [], now);
            expect(expired).toBe(true);
        });

        it('returns false when cochera subscription is active and not expired', () => {
            const clientCocheras = [
                { id: 'coch-75', numero: '75', tipo: 'Fija', precioBase: 860000, clienteId: 'c-eugenio', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-75', spotNumber: '75', type: 'Fija', customerId: 'c-eugenio', endDate: '2026-10-31T23:59:59Z', active: true }
            ];
            const now = new Date('2026-10-19T18:00:00Z');
            const expired = hasCustomerExpiredSubscription(clientCocheras, clientSubscriptions, [], now);
            expect(expired).toBe(false);
        });

        it('does not label as expired if cochera has no valid tariff (precioBase <= 0 and sub has no price)', () => {
            const clientCocheras = [
                { id: 'coch-75', numero: '75', tipo: 'Fija', precioBase: 0, clienteId: 'c-eugenio', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-75', spotNumber: '75', type: 'Fija', customerId: 'c-eugenio', endDate: '2026-09-30T23:59:59Z', active: true }
            ];
            const now = new Date('2026-10-19T18:00:00Z');
            const expired = hasCustomerExpiredSubscription(clientCocheras, clientSubscriptions, [], now);
            expect(expired).toBe(false);
        });

        it('returns false when client has no cocheras', () => {
            expect(hasCustomerExpiredSubscription([], [], [])).toBe(false);
        });
    });

    describe('calculateCustomerBalance', () => {
        const testNow = new Date('2026-10-19T18:00:00Z');

        it('Caso 1 — Eugenio Triciclo: spot #75, precioBase $860.000, expired 30/09, no persisted debt -> $860.000', () => {
            const clientCocheras = [
                { id: 'coch-75', numero: '75', tipo: 'Fija', precioBase: 860000, clienteId: '4375d86e-bd8d-4252-bbee-3f1248d25b19', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-75', cocheraId: 'coch-75', spotNumber: '75', customerId: '4375d86e-bd8d-4252-bbee-3f1248d25b19', endDate: '2026-10-01T02:59:59.999Z', active: true }
            ];
            const allDebts: any[] = []; // No PENDING debts

            const balance = calculateCustomerBalance(clientCocheras, clientSubscriptions, [], allDebts, testNow);
            expect(balance).toBe(860000);
        });

        it('Caso 2 — Eugorbeli Pedryto: expired cochera with base price $860.000 -> $860.000', () => {
            const clientCocheras = [
                { id: 'coch-44', numero: '44', tipo: 'Fija', precioBase: 860000, clienteId: '28bd783e-dbc5-4599-af1e-4dee66466f14', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-44', cocheraId: 'coch-44', customerId: '28bd783e-dbc5-4599-af1e-4dee66466f14', endDate: '2026-10-01T02:59:59.999Z', active: true }
            ];
            const allDebts: any[] = [];

            const balance = calculateCustomerBalance(clientCocheras, clientSubscriptions, [], allDebts, testNow);
            expect(balance).toBe(860000);
        });

        it('Caso 3 — Hernando Trolabio: spot Platea with 2 vehicles, precioBase $1.175.000, 1 persisted debt -> $1.175.000 (NOT duplicated)', () => {
            const clientCocheras = [
                { 
                    id: 'coch-platea', 
                    numero: 'Platea', 
                    tipo: 'Fija', 
                    precioBase: 1175000, 
                    clienteId: '6469d975-e753-47d2-b8e5-f5be42ac7028', 
                    status: 'Ocupada',
                    vehiculos: ['AAQ341', 'FEG512']
                }
            ];
            const clientSubscriptions = [
                { 
                    id: 'sub-trolabio', 
                    cocheraId: 'coch-platea', 
                    customerId: '6469d975-e753-47d2-b8e5-f5be42ac7028', 
                    endDate: '2026-10-01T02:59:59.999Z', 
                    active: true 
                }
            ];
            const allDebts = [
                {
                    id: 'debt-trolabio',
                    subscriptionId: 'sub-trolabio',
                    customerId: '6469d975-e753-47d2-b8e5-f5be42ac7028',
                    amount: 1175000,
                    remaining_amount: 1175000,
                    status: 'PENDING',
                    type: 'CANON'
                }
            ];

            const balance = calculateCustomerBalance(clientCocheras, clientSubscriptions, [], allDebts, testNow);
            // Must be exactly 1.175.000 (persisted debt is counted, cochera.precioBase is NOT duplicated, and vehicles do not multiply)
            expect(balance).toBe(1175000);
        });

        it('respects partial payment on persisted debt and does not duplicate with cochera base', () => {
            const clientCocheras = [
                { id: 'coch-1', numero: '1', tipo: 'Fija', precioBase: 1000000, clienteId: 'c1', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-1', cocheraId: 'coch-1', customerId: 'c1', endDate: '2026-10-01T02:59:59.999Z', active: true }
            ];
            const allDebts = [
                {
                    id: 'd1',
                    subscriptionId: 'sub-1',
                    customerId: 'c1',
                    amount: 1000000,
                    remaining_amount: 700000,
                    amount_paid: 300000,
                    status: 'PENDING',
                    type: 'CANON'
                }
            ];

            const balance = calculateCustomerBalance(clientCocheras, clientSubscriptions, [], allDebts, testNow);
            expect(balance).toBe(700000);
        });

        it('returns 0 for current active cochera without debt', () => {
            const clientCocheras = [
                { id: 'coch-1', numero: '1', tipo: 'Fija', precioBase: 500000, clienteId: 'c1', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-1', cocheraId: 'coch-1', customerId: 'c1', endDate: '2026-11-30T23:59:59Z', active: true }
            ];

            const balance = calculateCustomerBalance(clientCocheras, clientSubscriptions, [], [], testNow);
            expect(balance).toBe(0);
        });

        it('returns 0 for client without cocheras or debts', () => {
            const balance = calculateCustomerBalance([], [], [], [], testNow);
            expect(balance).toBe(0);
        });

        it('sums correctly across multiple cocheras for the same customer', () => {
            const clientCocheras = [
                { id: 'coch-1', numero: '1', tipo: 'Fija', precioBase: 860000, clienteId: 'c-multi', status: 'Ocupada' },
                { id: 'coch-2', numero: '2', tipo: 'Fija', precioBase: 500000, clienteId: 'c-multi', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-1', cocheraId: 'coch-1', customerId: 'c-multi', endDate: '2026-10-01T02:59:59.999Z', active: true },
                { id: 'sub-2', cocheraId: 'coch-2', customerId: 'c-multi', endDate: '2026-10-01T02:59:59.999Z', active: true }
            ];
            const allDebts = [
                // coch-2 has a persisted debt of 500000; coch-1 has unpersisted expired renewal of 860000
                {
                    id: 'debt-sub-2',
                    subscriptionId: 'sub-2',
                    customerId: 'c-multi',
                    amount: 500000,
                    remaining_amount: 500000,
                    status: 'PENDING',
                    type: 'CANON'
                }
            ];

            const balance = calculateCustomerBalance(clientCocheras, clientSubscriptions, [], allDebts, testNow);
            expect(balance).toBe(860000 + 500000); // 1.360.000
        });

        it('includes legitimate manual charges (MANUAL_MIGRATION)', () => {
            const clientCocheras = [
                { id: 'coch-1', numero: '1', tipo: 'Fija', precioBase: 860000, clienteId: 'c1', status: 'Ocupada' }
            ];
            const clientSubscriptions = [
                { id: 'sub-1', cocheraId: 'coch-1', customerId: 'c1', endDate: '2026-10-01T02:59:59.999Z', active: true }
            ];
            const allDebts = [
                {
                    id: 'manual-1',
                    customerId: 'c1',
                    amount: 50000,
                    remaining_amount: 50000,
                    status: 'PENDING',
                    type: 'MANUAL_MIGRATION'
                }
            ];

            const balance = calculateCustomerBalance(clientCocheras, clientSubscriptions, [], allDebts, testNow);
            expect(balance).toBe(860000 + 50000); // 910.000
        });
    });
});

