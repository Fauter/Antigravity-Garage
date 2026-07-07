import { Request, Response } from 'express';
import { AccessManager } from '../domain/AccessManager';
import { StayRepository } from './StayRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { CustomerRepository } from '../../Garage/infra/CustomerRepository';
import { SubscriptionRepository } from '../../Garage/infra/SubscriptionRepository';

import { JsonDB } from '../../../infrastructure/database/json-db';
import { db } from '../../../infrastructure/database/datastore';
import { v4 as uuidv4 } from 'uuid';
import { CorrelativeGenerator } from '../../../shared/CorrelativeGenerator';

interface VehicleTypeData {
    id?: string;
    _id?: string;
    name: string;
    hora: boolean;
    mensual: boolean;
}


export class AccessController {
    private stayRepository: StayRepository;
    private movementRepository: MovementRepository;
    private vehicleRepository: VehicleRepository;
    private customerRepository: CustomerRepository;
    private subscriptionRepository: SubscriptionRepository;

    constructor() {
        this.stayRepository = new StayRepository();
        this.movementRepository = new MovementRepository();
        this.vehicleRepository = new VehicleRepository();
        this.customerRepository = new CustomerRepository();
        this.subscriptionRepository = new SubscriptionRepository();
    }

    registerEntry = async (req: Request, res: Response) => {
        try {
            const rawPlate = req.body.plate;
            const vehicleTypeId = req.body.vehicleTypeId;
            // Prepaid / Anticipado fields
            const prepaidTariffId = req.body.prepaidTariffId;
            const prepaidPaymentMethod = req.body.prepaidPaymentMethod || 'Efectivo';
            const prepaidInvoiceType = req.body.prepaidInvoiceType || 'Final';
            const operator = req.body.operator || 'Sistema';
            const garageId = (req.headers['x-garage-id'] as string);

            if (!rawPlate) return res.status(400).json({ error: 'Plate is required' });

            // Normalize plate: uppercase, remove spaces, dashes, and underscores
            const plate = rawPlate.trim().toUpperCase().replace(/[\s\-_]/g, '');

            if (!garageId) {
                console.warn('⚠️ AccessController: Missing x-garage-id header on entry');
            }

            // 0. Check for existing Active Stay (Prevent Double Entry)
            const existingStay = await this.stayRepository.findActiveByPlateOrTicket(plate, garageId);
            if (existingStay) {
                return res.status(409).json({ error: 'Vehicle already in garage', stay: existingStay });
            }

            // 1. Resolve Vehicle Type (UUID -> Name) con validación de Garage
            let resolvedType = 'Auto'; // Default de seguridad

            if (vehicleTypeId) {
                // Buscar directamente en el datastore donde SyncService guarda los datos
                const found: any = await db.vehicleTypes.findOne({
                    $or: [{ id: vehicleTypeId }, { _id: vehicleTypeId }],
                    garageId: garageId
                });

                if (found) {
                    resolvedType = found.name;
                    console.log(`✅ Tipo de vehículo resuelto desde NeDB: ${resolvedType} (${garageId})`);
                } else {
                    console.warn(`⚠️ ID ${vehicleTypeId} no encontrado en NeDB para el garage ${garageId}. Verificando fallback...`);
                    const fallback: any = await db.vehicleTypes.findOne({ $or: [{ id: vehicleTypeId }, { _id: vehicleTypeId }] });
                    if (fallback) resolvedType = fallback.name;
                }
            }

            // 3. Check for Active Subscription
            const activeSubscription = await this.subscriptionRepository.findActiveByPlate(plate);
            const isSubscriber = !!activeSubscription;
            const subscriptionId = activeSubscription ? activeSubscription.id : null;

            if (isSubscriber) {
                console.log(`💎 Entry: Subscriber Detected for ${plate}`);
            }

            // 2. Resolve Vehicle Identity & Persist Subscriber Status
            let vehicleId: string;
            let existingVehicle = await this.vehicleRepository.findByPlate(plate, garageId);

            if (existingVehicle) {
                // REUSE & UPDATE
                vehicleId = existingVehicle.id!;
                // Update is_subscriber status ONLY if we are granting a new subscription (false -> true)
                const currentlySubscribed = existingVehicle.isSubscriber || (existingVehicle as any).is_subscriber;

                if (!currentlySubscribed && isSubscriber) {
                    (existingVehicle as any).is_subscriber = true;
                    existingVehicle.isSubscriber = true; // Keep obj sync
                    await this.vehicleRepository.save(existingVehicle);
                    console.log(`🚗 Entry: Updated Vehicle ${vehicleId} subscriber status to true`);
                } else if (currentlySubscribed && !isSubscriber) {
                    // Protegemos el estado: nunca pasamos de true a false aquí al registrar entrada
                    console.log(`🚗 Entry: Vehicle ${vehicleId} kept subscriber status true despite no active sub found`);
                }
            } else {
                // CREATE NEW
                vehicleId = uuidv4();
                if (garageId) {
                    await this.vehicleRepository.save({
                        id: vehicleId,
                        plate,
                        type: resolvedType,
                        garageId,
                        is_subscriber: isSubscriber, // Persist status
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    } as any);
                    console.log(`🆕 Entry: Created new vehicle ${vehicleId} for ${plate} (Subscriber: ${isSubscriber})`);
                }
            }

            // 4. Generate Correlative Ticket Code
            const ticketCode = await CorrelativeGenerator.nextStayTicket(garageId);

            // 4.5. Resolve Prepaid / Anticipado Options
            let prepaidOptions: { isPrepaid: boolean; prepaidUntil: Date; prepaidTariffId: string } | undefined;
            let prepaidAmount = 0;
            let prepaidTariffName = '';

            if (prepaidTariffId) {
                // Lookup tariff in local DB
                const tariff: any = await db.tariffs.findOne({
                    $or: [{ id: prepaidTariffId }, { _id: prepaidTariffId }],
                    garageId
                });

                if (tariff) {
                    prepaidTariffName = tariff.name || 'Anticipado';
                    const d = Number(tariff.days || 0);
                    const h = Number(tariff.hours || 0);
                    const m = Number(tariff.minutes || 0);
                    const blockMs = ((d * 1440) + (h * 60) + m) * 60000;

                    if (blockMs > 0) {
                        const now = new Date();
                        const prepaidUntil = new Date(now.getTime() + blockMs);

                        prepaidOptions = {
                            isPrepaid: true,
                            prepaidUntil,
                            prepaidTariffId
                        };

                        // Lookup price from price matrix
                        const repoMethod = prepaidPaymentMethod === 'Efectivo' ? 'standard' : 'electronic';
                        const priceRecord: any = await db.prices.findOne({
                            garageId,
                            tariffId: prepaidTariffId,
                            vehicleTypeId: vehicleTypeId,
                            priceList: repoMethod
                        });
                        prepaidAmount = priceRecord ? Number(priceRecord.amount || 0) : 0;

                        console.log(`⏱️ Entry: Prepaid activated for ${plate}. Tariff: ${prepaidTariffName}, Until: ${prepaidUntil.toISOString()}, Amount: $${prepaidAmount}`);
                    } else {
                        console.warn(`⚠️ Entry: Prepaid tariff ${prepaidTariffId} has zero duration. Ignoring prepaid.`);
                    }
                } else {
                    console.warn(`⚠️ Entry: Prepaid tariff ${prepaidTariffId} not found in NeDB. Ignoring prepaid.`);
                }
            }

            // 5. Process Entry
            const entry = AccessManager.processEntry(
                plate,
                existingVehicle || ({ id: vehicleId } as any),
                null,
                isSubscriber,
                subscriptionId,
                ticketCode,
                prepaidOptions
            );

            // Patch linking details
            (entry as any).vehicleType = resolvedType;
            (entry as any).vehicleId = vehicleId;
            if (garageId) (entry as any).garageId = garageId;

            // 🔓 HARDWARE: Explicitly reset/ensure hardware fields for new entry
            Object.assign(entry as any, {
                exit_authorized: false,
                barrier_exit_used: false,
                is_pending_processing: false,
                anpr_suggested_plate: null,
                entry_photo_path: req.body.photoPath || null,
                exit_authorized_at: null,
                barrier_exit_at: null
            });

            const savedStay = await this.stayRepository.save(entry as any);

            // 6. Generate Prepaid Movement (if applicable)
            if (prepaidOptions && prepaidAmount > 0) {
                // Fetch Owner ID from Garage Config
                let ownerId: string | undefined;
                if (garageId) {
                    const garage: any = await db.garages.findOne({ id: garageId });
                    if (garage) ownerId = garage.owner_id || garage.ownerId;
                }

                const receiptNumber = await CorrelativeGenerator.nextReceiptNumber(garageId);
                const ticketNumber = Number(Date.now().toString().slice(-9));

                const prepaidMovement = {
                    id: uuidv4(),
                    garageId,
                    ownerId,
                    ticketNumber,
                    relatedEntityId: entry.id,
                    type: 'CobroEstadia' as const,
                    timestamp: new Date(),
                    amount: prepaidAmount,
                    paymentMethod: prepaidPaymentMethod,
                    operator: operator,
                    invoiceType: prepaidInvoiceType,
                    plate: plate,
                    notes: `Pago Anticipado - ${prepaidTariffName}`,
                    receipt_number: receiptNumber,
                    ticket_code: receiptNumber,
                    createdAt: new Date(),
                };

                await this.movementRepository.save(prepaidMovement as any);
                console.log(`💰 Entry: Prepaid Movement saved for ${plate}. Amount: $${prepaidAmount}, Method: ${prepaidPaymentMethod}`);

                // Attach prepaid info to response so frontend can confirm
                (savedStay as any).prepaidMovement = prepaidMovement;
                return res.status(201).json({ stay: savedStay, prepaidMovement });
            }

            res.status(201).json({ stay: savedStay });
        } catch (error: any) {
            console.error('Entry Error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    registerExit = async (req: Request, res: Response) => {
        try {
            const rawPlate = req.body.plate;
            const { paymentMethod, operator, invoiceType, promoPercentage } = req.body;
            const garageId = (req.headers['x-garage-id'] as string);

            if (!rawPlate) return res.status(400).json({ error: 'Plate is required' });

            const plate = rawPlate.trim().toUpperCase().replace(/[\s\-_]/g, '');

            const stay = await this.stayRepository.findActiveByPlateOrTicket(plate, garageId);
            if (!stay) {
                return res.status(404).json({ error: 'No active stay found for plate' });
            }

            // 🔍 Phase 2: Re-validate Subscription Link on Exit directly against Vehicle Table
            const vehicle = await this.vehicleRepository.findByPlate(plate, garageId);
            let isSubscriber = false;
            if (vehicle) {
                isSubscriber = vehicle.isSubscriber || (vehicle as any).is_subscriber;
                stay.isSubscriber = isSubscriber;
                (stay as any).is_subscriber = isSubscriber;
            }

            const activeSubscription = await this.subscriptionRepository.findActiveByPlate(plate);
            stay.subscriptionId = activeSubscription ? activeSubscription.id : null;

            if (isSubscriber) {
                console.log(`💎 Exit: Verified Active Subscription for ${plate} via Vehicle`);
            } else {
                console.log(`ℹ️ Exit: Vehicle ${plate} is not a subscriber`);
            }

            // Matrix is now handled internally by PricingEngine -> Repositories
            // const matrix = await getPricingMatrix();

            // Metadata Injection
            const cleanOperator = typeof operator === 'string' ? operator.trim() : '';
            const userOperator = (cleanOperator && cleanOperator !== 'undefined undefined' && cleanOperator !== 'null null') ? cleanOperator : 'Sistema';

            // Fetch Owner ID from Garage Config (if available)
            let ownerId: string | undefined;
            if (garageId) {
                // Now db.garages exists
                const garage: any = await db.garages.findOne({ id: garageId });
                if (garage) ownerId = garage.owner_id || garage.ownerId;
            }

            // Generate Correlative Receipt Number
            const receiptNumber = await CorrelativeGenerator.nextReceiptNumber(garageId);

            // Generate Ticket Number (legacy numeric, kept for backward compat)
            const ticketNumber = Number(Date.now().toString().slice(-9));

            // Pass to Manager (async)
            const { closedStay, exitMovement, price } = await AccessManager.processExit(
                stay as any,
                new Date(),
                paymentMethod as any,
                userOperator,
                invoiceType,
                garageId,
                ownerId,
                ticketNumber,
                Number(promoPercentage) || 0
            );

            // 🔓 HARDWARE: Inject exit authorization BEFORE save()
            // This ensures the full document replacement in save() includes exit_authorized: true,
            // and the sync mutation payload also carries the correct value.
            Object.assign(closedStay as any, {
                exit_authorized: true,
                exit_authorized_at: new Date(),
                exit_authorized_by: userOperator
            });
            console.log(`🔓 Exit: Barrier authorized for ${closedStay.plate} (ticket: ${(closedStay as any).ticket_code})`);

            await this.stayRepository.save(closedStay as any);

            if (exitMovement) {
                // Inject correlative receipt_number and ticket_code
                (exitMovement as any).receipt_number = receiptNumber;
                (exitMovement as any).ticket_code = receiptNumber;
                await this.movementRepository.save(exitMovement);
            }

            // 🧟 ZOMBIE CLEANUP: Close any other open stays for this plate
            // This ensures the HardwareService finds the SAME stay the cashier authorized
            const stayId = closedStay.id || (closedStay as any)._id;
            const zombiesClosed = await this.stayRepository.closeZombieStays(plate, stayId, garageId);
            if (zombiesClosed > 0) {
                console.log(`🧟 Exit: Cleaned up ${zombiesClosed} zombie stays for ${plate}`);
            }

            res.json({ stay: closedStay, movement: exitMovement, price });
        } catch (error: any) {
            console.error('Exit error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    quoteExit = async (req: Request, res: Response) => {
        try {
            const rawPlate = req.body.plate;
            const { paymentMethod, promoPercentage } = req.body;
            const garageId = (req.headers['x-garage-id'] as string);

            if (!rawPlate) return res.status(400).json({ error: 'Plate is required' });

            const plate = rawPlate.trim().toUpperCase().replace(/[\s\-_]/g, '');

            const stay = await this.stayRepository.findActiveByPlateOrTicket(plate, garageId);
            if (!stay) {
                return res.status(404).json({ error: 'No active stay found for plate' });
            }

            // Re-validate subscriber status
            const vehicle = await this.vehicleRepository.findByPlate(plate, garageId);
            if (vehicle) {
                const subStatus = vehicle.isSubscriber || (vehicle as any).is_subscriber;
                stay.isSubscriber = subStatus;
                (stay as any).is_subscriber = subStatus;
            }

            const price = await AccessManager.quoteExit(
                stay as any,
                paymentMethod || 'Efectivo',
                garageId,
                Number(promoPercentage) || 0
            );

            res.json({ price });
        } catch (error: any) {
            console.error('Quote error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    getActiveStay = async (req: Request, res: Response) => {
        try {
            const rawPlate = req.params.plate;
            const garageId = (req.headers['x-garage-id'] as string) || '';
            const plate = String(rawPlate).trim().toUpperCase().replace(/[\s\-_]/g, '');
            const stay = await this.stayRepository.findActiveByPlateOrTicket(plate, garageId);
            if (!stay) return res.status(404).json({ error: 'Stay not found' });

            // CRÍTICO: Garantía de datos directos de la tabla Vehicle
            const vehicle = await this.vehicleRepository.findByPlate(plate, garageId);
            if (vehicle) {
                const subStatus = vehicle.isSubscriber || (vehicle as any).is_subscriber;
                stay.isSubscriber = subStatus;
                (stay as any).is_subscriber = subStatus;
            }

            // --- NUEVO: Cotización Automática y Tiempo de Gracia ---
            const price = await AccessManager.quoteExit(stay as any, 'Efectivo', garageId, 0);
            (stay as any).price = price;

            // Prepaid flags for frontend
            const stayIsPrepaid = (stay as any).isPrepaid === true;
            (stay as any).isPrepaid = stayIsPrepaid;
            (stay as any).isPrepaidCovered = stayIsPrepaid && price === 0;

            // Evaluamos is_grace_period (NOT triggered by prepaid — separate concept)
            let isGracePeriod = false;
            if (!stay.isSubscriber && !stayIsPrepaid && price === 0) {
                isGracePeriod = true;
            }
            (stay as any).is_grace_period = isGracePeriod;

            res.json(stay);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    getAllActiveStays = async (req: Request, res: Response) => {
        try {
            const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);

            // Pass garageId to repository
            const stays = await this.stayRepository.findAllActive(garageId);

            // Enrichment: If stay doesn't have explicit vehicle type, try to find it via VehicleModel
            // We need to import VehicleModel locally or use Repository if available.
            // Since this is "Infra", we can use the Model directly for this enrichment step or use VehicleRepository.
            // Let's use VehicleRepository if it has findByPlate. check: this.vehicleRepository
            // Actually, for bulk efficiency, let's just do a Model query if needed, or iterate.

            // Note: Since we are in Mongoose migration, let's use VehicleModel directly for speed in this step
            // to avoid modifying VehicleRepository right now.
            // Import real path (Refactored to Source of Truth)
            const { VehicleModel: VM } = await import('../../../infrastructure/database/models.js');

            const populatedStays = await Promise.all(stays.map(async (stay) => {
                let vType = stay.vehicleType;

                if (!vType && VM) {
                    const vehicle = await VM.findOne({ plate: stay.plate, garageId });
                    if (vehicle) {
                        vType = vehicle.type; // e.g. "Auto"
                    }
                }

                return {
                    ...stay,
                    vehicleType: vType || 'Auto' // Default to Auto if unknown
                };
            }));

            res.json(populatedStays);
        } catch (error: any) {
            console.error('Error fetching stays:', error);
            res.status(500).json({ error: error.message });
        }
    }

    getAllMovements = async (req: Request, res: Response) => {
        try {
            const movements = await this.movementRepository.findAll();
            res.json(movements);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    reset = async () => {
        await this.stayRepository.reset();
        await this.movementRepository.reset();
    }


}
