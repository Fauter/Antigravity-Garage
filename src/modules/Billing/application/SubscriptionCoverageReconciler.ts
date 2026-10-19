import { Subscription, Debt, Movement } from '../../../shared/schemas.js';
import { DebtSelector } from '../domain/DebtSelector.js';
import { BillingPeriodHelper } from '../domain/BillingPeriodHelper.js';

export class SubscriptionCoverageReconciler {
    /**
     * Reconcilia el endDate de una suscripción basándose ÚNICAMENTE en evidencia persistida:
     * - Deudas CANON PAID
     * - Movimientos de ADVANCE
     */
    public reconcileCoverage(
        subscription: Subscription,
        garageId: string,
        allDebts: Debt[],
        allMovements: Movement[]
    ): Date {
        // 1. Filtrar deudas válidas para esta suscripción y garage
        const canonDebts = allDebts.filter(d => 
            (d.subscriptionId === subscription.id || (d as any).subscription_id === subscription.id) &&
            ((d as any).garageId === garageId || (d as any).garage_id === garageId) &&
            d.type === 'CANON'
        );

        const paidCanonDebts = canonDebts.filter(d => 
            d.status === 'PAID' || (d as any).remaining_amount === 0 || d.amount_paid === d.amount
        );

        // 2. Filtrar movimientos válidos
        const subMovements = allMovements.filter(m => 
            (m.relatedEntityId === subscription.id || (m as any).related_entity_id === subscription.id) &&
            ((m as any).garageId === garageId || (m as any).garage_id === garageId) &&
            m.type === 'CobroAbono'
        );

        let latestCoveredDate = new Date(subscription.startDate);

        // 3. Evaluar cobertura de deudas CANON (ordenadas cronológicamente)
        const sortedDebts = canonDebts.sort((a, b) => {
            const pA = DebtSelector.getBillingPeriodKey(a);
            const pB = DebtSelector.getBillingPeriodKey(b);
            return pA.localeCompare(pB);
        });

        if (sortedDebts.length > 0) {
            // Asumimos que todo lo anterior a la primera deuda está cubierto (por ej. si se archivó)
            const firstPeriod = DebtSelector.getBillingPeriodKey(sortedDebts[0]);
            const [y, m] = firstPeriod.split('-');
            // La fecha base es justo antes de que empiece este primer período
            latestCoveredDate = new Date(Date.UTC(Number(y), Number(m) - 1, 1, 3, 0, 0, 0) - 1);
        }
        // ELIMINADO: el bloque `else` que usaba `subscription.endDate` como fallback,
        // ya que causaba un double-counting infinito de movimientos Advance históricos.

        for (const debt of sortedDebts) {
            const period = DebtSelector.getBillingPeriodKey(debt);
            const isPaid = debt.status === 'PAID' || 
                           ((debt as any).remaining_amount === 0 && debt.amount !== undefined) || 
                           (debt.amount_paid !== undefined && debt.amount_paid === debt.amount);
            
            if (isPaid) {
                const [year, month] = period.split('-');
                const debtCoverageEnd = new Date(Date.UTC(Number(year), Number(month), 1, 3, 0, 0, 0) - 1);
                if (debtCoverageEnd > latestCoveredDate) {
                    latestCoveredDate = debtCoverageEnd;
                }
            } else {
                // Hueco detectado, se detiene la contigüidad
                break;
            }
        }

        // 4. Evaluar ADVANCES (Legacy y Modern) de forma idempotente
        const sortedMovements = subMovements.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // Base acumulativa independiente para calcular Legacy Advances sin double-counting
        let legacyAdvanceBase = new Date(latestCoveredDate);

        for (const mov of sortedMovements) {
            const explicitPeriodMatch = mov.notes ? mov.notes.match(/Per[ií]odo\s+(\d{4}-\d{2})/i) : null;
            const hasMetadata = (mov as any).metadata && (mov as any).metadata.RenewalMode === 'ADVANCE' && (mov as any).metadata.BillingPeriod;

            // Modern ADVANCE check
            if (explicitPeriodMatch || hasMetadata) {
                const advancePeriod = explicitPeriodMatch ? explicitPeriodMatch[1] : (mov as any).metadata.BillingPeriod;
                const debtExistsForNextPeriod = canonDebts.some(d => DebtSelector.getBillingPeriodKey(d) === advancePeriod && d.status !== 'PAID');
                
                if (!debtExistsForNextPeriod) {
                    const [year, month] = advancePeriod.split('-');
                    const advanceCoverageEnd = new Date(Date.UTC(Number(year), Number(month), 1, 3, 0, 0, 0) - 1);
                    
                    if (advanceCoverageEnd > latestCoveredDate) {
                        latestCoveredDate = advanceCoverageEnd;
                    }
                    if (advanceCoverageEnd > legacyAdvanceBase) {
                        legacyAdvanceBase = advanceCoverageEnd;
                    }
                }
            }
            // Legacy ADVANCE check
            else if (mov.notes && (mov.notes.includes('Renovacin Abono Anticipada') || mov.notes.includes('Renovación Abono Anticipada'))) {
                // El Legacy Advance asume el siguiente mes posterior a la base demostrada.
                // Avanzamos 1 ms para entrar en el siguiente período lógico.
                const nextPeriodDate = new Date(legacyAdvanceBase.getTime() + 1);
                const advancePeriod = BillingPeriodHelper.getBillingPeriod(nextPeriodDate);
                
                const debtExistsForNextPeriod = canonDebts.some(d => DebtSelector.getBillingPeriodKey(d) === advancePeriod && d.status !== 'PAID');
                
                if (!debtExistsForNextPeriod) {
                    const [year, month] = advancePeriod.split('-');
                    const advanceCoverageEnd = new Date(Date.UTC(Number(year), Number(month), 1, 3, 0, 0, 0) - 1);
                    
                    legacyAdvanceBase = advanceCoverageEnd;
                    if (advanceCoverageEnd > latestCoveredDate) {
                        latestCoveredDate = advanceCoverageEnd;
                    }
                }
            }
        }

        return latestCoveredDate;
    }
}
