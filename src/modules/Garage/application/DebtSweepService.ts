import { SubscriptionRepository } from '../infra/SubscriptionRepository.js';
import { DebtRepository } from '../infra/DebtRepository.js';
import { VehicleRepository } from '../infra/VehicleRepository.js';
import { ConfigRepository } from '../../Configuration/infra/ConfigRepository.js';
import { BillingPeriodHelper } from '../../Billing/domain/BillingPeriodHelper.js';
import { CanonFactory } from '../domain/CanonFactory.js';

export interface DebtSweepSummary {
    garageId: string;
    evaluatedSubscriptions: number;
    evaluatedPeriods: number;
    created: number;
    existing: number;
    skipped: number;
    errors: number;
}

const runningSweeps = new Map<string, boolean>();

export class DebtSweepService {
    static async runForGarage(garageId: string, dependencies?: any): Promise<DebtSweepSummary> {
        if (!garageId) throw new Error('garageId is required');

        const summary: DebtSweepSummary = {
            garageId,
            evaluatedSubscriptions: 0,
            evaluatedPeriods: 0,
            created: 0,
            existing: 0,
            skipped: 0,
            errors: 0
        };

        if (runningSweeps.get(garageId)) {
            console.log(`[DEBT SWEEP] garage=${garageId} skipped (already running)`);
            return summary;
        }

        runningSweeps.set(garageId, true);
        console.log(`[DEBT SWEEP] garage=${garageId} started`);

        try {
            const subscriptionRepo = dependencies?.subscriptionRepo || new SubscriptionRepository();
            const debtRepo = dependencies?.debtRepo || new DebtRepository();
            const vehicleRepo = dependencies?.vehicleRepo || new VehicleRepository();
            const configRepo = dependencies?.configRepo || new ConfigRepository();

            const { CocheraRepository } = await import('../infra/CocheraRepository.js');
            const cocheraRepo = dependencies?.cocheraRepo || new CocheraRepository();

            let subs = await subscriptionRepo.findAll();
            subs = subs.filter((s: any) => (s.garageId === garageId || s.garage_id === garageId) && s.active && s.endDate);

            summary.evaluatedSubscriptions = subs.length;

            const allCocheras = await cocheraRepo.findAll();

            const [prices, vehicleTypes, tariffs] = await Promise.all([
                configRepo.getPrices(garageId, 'standard'),
                configRepo.getVehicleTypes(garageId),
                configRepo.getTariffs(garageId)
            ]);

            const vTypeMap = new Map(vehicleTypes.map((v: any) => [v.id.trim(), v.name]));
            const tariffMap = new Map(tariffs.map((t: any) => [t.id.trim(), t.name]));

            const standardMatrix: Record<string, Record<string, number>> = {};
            prices.forEach((p: any) => {
                const vIdRaw = (p.vehicleTypeId || p.vehicle_type_id || '').trim();
                const tIdRaw = (p.tariffId || p.tariff_id || '').trim();
                const vName = vTypeMap.get(vIdRaw);
                const tName = tariffMap.get(tIdRaw);
                if (vName && tName) {
                    const vKey = String(vName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                    const tKey = String(tName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                    if (!standardMatrix[vKey]) standardMatrix[vKey] = {};
                    standardMatrix[vKey][tKey] = Number(p.amount || 0);
                }
            });

            const now = new Date();

            for (const sub of subs) {
                try {
                    let subEndDate = new Date(sub.endDate!);
                    let loopCount = 0;
                    const MAX_LOOPS = 24;

                    const subClientId = sub.customerId || (sub as any).clientId;

                    let subPlate = sub.plate || sub.vehicleData?.plate || (sub as any).vehicle_plate;
                    let vKey = '';
                    const vehicleId = sub.vehicleId || (sub as any).vehicle_id;

                    if (!subPlate && vehicleId) {
                        const v = await (vehicleRepo as any).findById(vehicleId);
                        if (v) {
                            subPlate = v.plate;
                            if (v.type) {
                                vKey = String(v.type).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                            }
                        }
                    } else if (subPlate) {
                        const vehicle = await vehicleRepo.findByPlate(subPlate);
                        if (vehicle && vehicle.type) {
                            vKey = String(vehicle.type).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                        }
                    }

                    const subSpotNumber = (sub as any).spotNumber;

                    let relatedCochera = allCocheras.find((c: any) => {
                        if (c.clienteId !== subClientId) return false;
                        const isSpotMatch = subSpotNumber && c.numero === String(subSpotNumber);
                        const isPlateMatch = subPlate && c.vehiculos && c.vehiculos.some((v: any) =>
                            (typeof v === 'string' ? v : v.plate) === subPlate
                        );
                        return isSpotMatch || isPlateMatch;
                    });

                    if (!relatedCochera) {
                        relatedCochera = allCocheras.find((c: any) => c.clienteId === subClientId);
                    }

                    const cocheraBasePrice = relatedCochera ? Number(relatedCochera.precioBase || 0) : 0;

                    const subTypeRaw = sub.type || (sub as any).subscriptionType || 'Movil';
                    let tKey = String(subTypeRaw).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                    if (subTypeRaw === 'Exclusiva') tKey = 'abono exclusivo';
                    else tKey = `abono ${tKey}`;

                    let resolvedPrice = 0;
                    if (vKey && standardMatrix[vKey]) {
                        if (standardMatrix[vKey][tKey]) {
                            resolvedPrice = standardMatrix[vKey][tKey];
                        } else if (standardMatrix[vKey][String(subTypeRaw).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()]) {
                            resolvedPrice = standardMatrix[vKey][String(subTypeRaw).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()];
                        }
                    }

                    // PRIORIDAD ESTRICTA: El precio del registro cocheraBasePrice (si existe y es > 0) PISA al precio de matriz
                    const finalPrice = cocheraBasePrice > 0 ? cocheraBasePrice : resolvedPrice;

                    if (finalPrice <= 0) {
                        console.log(`[DEBT SWEEP] SKIP sub=${sub.id} reason=NO_PRICE`);
                        summary.skipped++;
                        continue; // Safety abort
                    }

                    // Avanzamos mes a mes usando el BillingPeriodHelper para evitar problemas de timezone
                    // Evaluamos todos los meses desde el siguiente al vencimiento hasta el mes actual
                    
                    // Empezamos evaluando el mes INMEDIATAMENTE POSTERIOR al coverage
                    let currentEvalDate = new Date(subEndDate.getTime());
                    // Incrementamos al día 1 del siguiente mes en local time, al inicio del día
                    currentEvalDate.setDate(1);
                    currentEvalDate.setMonth(currentEvalDate.getMonth() + 1);
                    currentEvalDate.setHours(0, 0, 0, 0);

                    while (currentEvalDate <= now && loopCount < MAX_LOOPS) {
                        loopCount++;
                        summary.evaluatedPeriods++;

                        const billingPeriod = BillingPeriodHelper.getBillingPeriod(currentEvalDate);
                        
                        // FASE 5: Idempotency of Sweep
                        // Look up explicit semantic existence for this period
                        const existingDebt = await debtRepo.findCanonBySubscriptionGarageAndPeriod(sub.id, garageId, billingPeriod);

                        if (existingDebt) {
                            // Idempotency: the CANON for this period already exists logically.
                            // We do NOT overwrite it, we do NOT change it to PENDING if PAID.
                            // We simply leave it intact and proceed to the next period.
                            console.log(`[DEBT SWEEP] EXISTS sub=${sub.id} period=${billingPeriod} status=${existingDebt.status}`);
                            summary.existing++;
                        } else {
                            // Create the new canonical debt
                            // FASE 6: Use unified due date generation
                            const [yyyy, mm] = billingPeriod.split('-');
                            const dueDate = CanonFactory.getCanonDueDate(parseInt(yyyy, 10), parseInt(mm, 10) - 1); // mm is 1-indexed here, convert to 0-indexed month
                            
                            const newDebt = CanonFactory.createCanonDebt(
                                sub.id,
                                subClientId,
                                finalPrice,
                                billingPeriod,
                                dueDate,
                                garageId
                            );

                            await debtRepo.save(newDebt as any);
                            console.log(`[DEBT SWEEP] CREATE sub=${sub.id} period=${billingPeriod} amount=${finalPrice}`);
                            summary.created++;
                        }

                        // Avanzar al mes siguiente
                        currentEvalDate.setMonth(currentEvalDate.getMonth() + 1);
                    }
                } catch (evalError: any) {
                    console.error(`[DEBT SWEEP] Error en evaluación de deuda para sub ${sub.id}:`, evalError.message);
                    summary.errors++;
                }
            }

            console.log(`[DEBT SWEEP] completed garage=${garageId} subscriptions=${summary.evaluatedSubscriptions} periods=${summary.evaluatedPeriods} created=${summary.created} existing=${summary.existing} skipped=${summary.skipped} errors=${summary.errors}`);

        } finally {
            runningSweeps.delete(garageId);
        }

        return summary;
    }
}
