import { describe, it, expect } from 'vitest';
import { SubscriptionCoverageReconciler } from '../src/modules/Billing/application/SubscriptionCoverageReconciler';
import { DebtSelector } from '../src/modules/Billing/domain/DebtSelector';

describe('Subscription Coverage Reconciliation', () => {
    it('TEST DE STALE END DATE SIN ADVANCE: updates endDate to end of Sept', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: 'sub-1',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-09-01T02:59:59.999Z' // End of August
        };
        const debts = [
            { id: 'd1', subscriptionId: 'sub-1', garageId: 'g1', type: 'CANON', status: 'PAID', dueDate: new Date('2026-09-01T03:00:00.000Z') } // Sept
        ];
        
        const result = reconciler.reconcileCoverage(sub as any, 'g1', debts as any, []);
        expect(result.toISOString()).toBe('2026-10-01T02:59:59.999Z');
    });

    it('TEST CON DOS PAID CONTIGUAS: EndDate Julio -> fin Septiembre', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: 'sub-2',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-08-01T02:59:59.999Z' // End of July
        };
        const debts = [
            { id: 'd1', subscriptionId: 'sub-2', garageId: 'g1', type: 'CANON', status: 'PAID', dueDate: new Date('2026-08-01T03:00:00.000Z') }, // Aug
            { id: 'd2', subscriptionId: 'sub-2', garageId: 'g1', type: 'CANON', status: 'PAID', dueDate: new Date('2026-09-01T03:00:00.000Z') }  // Sept
        ];
        
        const result = reconciler.reconcileCoverage(sub as any, 'g1', debts as any, []);
        expect(result.toISOString()).toBe('2026-10-01T02:59:59.999Z');
    });

    it('TEST CON HUECO: Agosto PAID, Sept PENDING, Oct PAID', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: 'sub-3',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-08-01T02:59:59.999Z' // End of July
        };
        const debts = [
            { id: 'd1', subscriptionId: 'sub-3', garageId: 'g1', type: 'CANON', status: 'PAID', dueDate: new Date('2026-08-01T03:00:00.000Z') }, // Aug
            { id: 'd2', subscriptionId: 'sub-3', garageId: 'g1', type: 'CANON', status: 'PENDING', dueDate: new Date('2026-09-01T03:00:00.000Z') }, // Sept
            { id: 'd3', subscriptionId: 'sub-3', garageId: 'g1', type: 'CANON', status: 'PAID', dueDate: new Date('2026-10-01T03:00:00.000Z') }  // Oct
        ];
        
        const result = reconciler.reconcileCoverage(sub as any, 'g1', debts as any, []);
        // Should stop at August because Sept is missing/pending
        expect(result.toISOString()).toBe('2026-09-01T02:59:59.999Z');
    });

    it('TEST MULTI GARAGE y GHOSTS: ignores ghost debts and other garages', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: 'sub-4',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-09-01T02:59:59.999Z' // End of August
        };
        const debts = [
            // Ghost debt (garageId null)
            { id: 'd1', subscriptionId: 'sub-4', garageId: null, type: 'CANON', status: 'PAID', dueDate: new Date('2026-09-01T03:00:00.000Z') },
            // Other garage
            { id: 'd2', subscriptionId: 'sub-4', garageId: 'g2', type: 'CANON', status: 'PAID', dueDate: new Date('2026-09-01T03:00:00.000Z') }
        ];
        
        const result = reconciler.reconcileCoverage(sub as any, 'g1', debts as any, []);
        // Should return the baseline (startDate) because no valid debts exist in this garage.
        // El reconciliador ya NO usa endDate como fallback para evitar double-counting.
        expect(result.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    });

    it('TEST ADVANCE IDEMPOTENTE: handles legacy advance accurately', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: 'sub-5',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-09-01T02:59:59.999Z' // End of August
        };
        const debts = [
            // PAID Sept
            { id: 'd1', subscriptionId: 'sub-5', garageId: 'g1', type: 'CANON', status: 'PAID', dueDate: new Date('2026-09-01T03:00:00.000Z') }
        ];
        const movements = [
            { id: 'm1', relatedEntityId: 'sub-5', garageId: 'g1', type: 'CobroAbono', timestamp: new Date('2026-09-15T10:00:00Z'), notes: 'Renovación Abono Anticipada - Cochera #038' }
        ];
        
        let result = reconciler.reconcileCoverage(sub as any, 'g1', debts as any, movements as any);
        // Sept PAID -> end of Sept. Then Advance -> end of Oct.
        expect(result.toISOString()).toBe('2026-11-01T02:59:59.999Z');

        // Verify idempotency
        for (let i = 0; i < 100; i++) {
            sub.endDate = result.toISOString();
            result = reconciler.reconcileCoverage(sub as any, 'g1', debts as any, movements as any);
            expect(result.toISOString()).toBe('2026-11-01T02:59:59.999Z');
        }
    });

    it('TEST ADVANCE MODERN: correctly uses metadata', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: 'sub-6',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-09-01T02:59:59.999Z' // End of August
        };
        const debts = [
            // PAID Sept
            { id: 'd1', subscriptionId: 'sub-6', garageId: 'g1', type: 'CANON', status: 'PAID', dueDate: new Date('2026-09-01T03:00:00.000Z') }
        ];
        const movements = [
            { 
                id: 'm1', relatedEntityId: 'sub-6', garageId: 'g1', type: 'CobroAbono', 
                timestamp: new Date('2026-09-15T10:00:00Z'), 
                metadata: { RenewalMode: 'ADVANCE', BillingPeriod: '2026-10' } 
            }
        ];
        
        const result = reconciler.reconcileCoverage(sub as any, 'g1', debts as any, movements as any);
        expect(result.toISOString()).toBe('2026-11-01T02:59:59.999Z');
    });
    it('IDEMPOTENCIA - CASO 8: Pedryto - Legacy Advances no double-count', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: '74fb9033-28e8-4baa-ae1f-2ed512e42434',
            startDate: '2026-10-01T03:00:00.000Z',
            endDate: '2026-10-01T03:00:00.000Z', // Mismo que startDate, sin cobertura adicional
            active: false
        };
        const movements = [
            { timestamp: '2026-09-01T17:55:39.080Z', relatedEntityId: sub.id, garageId: 'g1', type: 'CobroAbono', notes: 'Renovación Abono Anticipada' },
            { timestamp: '2026-09-01T18:54:58.674Z', relatedEntityId: sub.id, garageId: 'g1', type: 'CobroAbono', notes: 'Renovación Abono Anticipada' }
        ];

        // Ejecución 1
        const result1 = reconciler.reconcileCoverage(sub as any, 'g1', [], movements as any);
        const expectedEnd = '2026-12-01T02:59:59.999Z'; // Starts 10-01, +2 meses de legacy advance = Fin de Noviembre
        expect(result1.toISOString()).toBe(expectedEnd);

        // Simulamos que el controller lo persistió y en la siguiente lectura el input endDate es mayor
        const subUpdated = { ...sub, endDate: result1.toISOString() };

        // Ejecución 2 (con el nuevo endDate)
        const result2 = reconciler.reconcileCoverage(subUpdated as any, 'g1', [], movements as any);
        expect(result2.toISOString()).toBe(expectedEnd); // NO AVANZA!

        // Ejecución múltiple
        let currentEnd = result1.toISOString();
        for (let i = 0; i < 20; i++) {
            const tempSub = { ...sub, endDate: currentEnd };
            currentEnd = reconciler.reconcileCoverage(tempSub as any, 'g1', [], movements as any).toISOString();
        }
        expect(currentEnd).toBe(expectedEnd); // Nunca crece más de lo demostrado
    });

    it('IDEMPOTENCIA - active status must remain unchanged', () => {
        const reconciler = new SubscriptionCoverageReconciler();
        const sub = {
            id: 'sub-inactive',
            startDate: '2026-01-01T03:00:00.000Z',
            endDate: '2026-01-01T03:00:00.000Z',
            active: false
        };
        const result = reconciler.reconcileCoverage(sub as any, 'g1', [], []);
        // reconciler solo devuelve fecha, no toca el active. 
        // El test real de esto es comprobar que NO lo vuelve a false ni true por el controller, 
        // pero validamos que no haya magia.
        expect(sub.active).toBe(false);
    });
});
