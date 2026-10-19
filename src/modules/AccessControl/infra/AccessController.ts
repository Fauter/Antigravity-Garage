import { Request, Response } from 'express';
import { AccessManager } from '../domain/AccessManager';
import { StayRepository } from './StayRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { CustomerRepository } from '../../Garage/infra/CustomerRepository';
import { SubscriptionRepository } from '../../Garage/infra/SubscriptionRepository';
import { AttachmentService } from '../../Sync/application/AttachmentService';
import { ConfigRepository } from '../../Configuration/infra/ConfigRepository';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine';
import { TerminalConfigManager } from '../../../infrastructure/config/TerminalConfigManager';
import { db } from '../../../infrastructure/database/datastore';

import { JsonDB } from '../../../infrastructure/database/json-db';
import { v4 as uuidv4 } from 'uuid';
import { CorrelativeService } from '../../../shared/CorrelativeService';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';
import { TransactionHelper } from '../../../infrastructure/database/sqlite/TransactionHelper';

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

    private getGarageOwnerId(garageId: string): string | undefined {
        if (!garageId) return undefined;
        try {
            const termCfg = TerminalConfigManager.getConfig();
            if (termCfg && termCfg.garage_id === garageId && termCfg.owner_id) {
                return termCfg.owner_id;
            }
        } catch {}
        try {
            const sqliteDb = SQLiteManager.getInstance().getDatabase();
            const row = sqliteDb.prepare('SELECT json_data FROM garages WHERE id = ?').get(garageId) as any;
            if (row && row.json_data) {
                const parsed = JSON.parse(row.json_data);
                return parsed.owner_id || parsed.ownerId;
            }
        } catch (e) {
            console.error('Error fetching garage owner:', e);
        }
        return undefined;
    }

    constructor(
        stayRepository?: StayRepository,
        movementRepository?: MovementRepository,
        vehicleRepository?: VehicleRepository,
        customerRepository?: CustomerRepository,
        subscriptionRepository?: SubscriptionRepository
    ) {
        this.stayRepository = stayRepository || new StayRepository();
        this.movementRepository = movementRepository || new MovementRepository();
        this.vehicleRepository = vehicleRepository || new VehicleRepository();
        this.customerRepository = customerRepository || new CustomerRepository();
        this.subscriptionRepository = subscriptionRepository || new SubscriptionRepository();
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
            const existingStay = typeof this.stayRepository.findActiveByPlateOrTicket === 'function'
                ? await this.stayRepository.findActiveByPlateOrTicket(plate, garageId)
                : null;
            if (existingStay) {
                return res.status(409).json({ error: 'Vehicle already in garage', stay: existingStay });
            }

            // 1. Resolve Vehicle Type (UUID -> Name) con validación de Garage
            let resolvedType = 'Auto'; // Default de seguridad

            if (vehicleTypeId) {
                const configRepo = new ConfigRepository();
                const vehicleTypes = await configRepo.getVehicleTypes(garageId);
                const found = vehicleTypes.find((vt: any) => vt.id === vehicleTypeId || (vt as any)._id === vehicleTypeId);

                if (found) {
                    resolvedType = found.name;
                    console.log(`✅ Tipo de vehículo resuelto: ${resolvedType} (${garageId})`);
                } else {
                    console.warn(`⚠️ ID ${vehicleTypeId} no encontrado para el garage ${garageId}. Fallback to Auto...`);
                }
            }

            // 3. Check for Active Subscription
            const activeSubscription = typeof this.subscriptionRepository.findActiveByPlate === 'function'
                ? await this.subscriptionRepository.findActiveByPlate(plate, garageId)
                : null;
            const isSubscriber = !!activeSubscription;
            const subscriptionId = activeSubscription ? activeSubscription.id : null;

            if (isSubscriber) {
                console.log(`💎 Entry: Subscriber Detected for ${plate}`);
            }

            // 2. Resolve Vehicle Identity & Prepare
            let vehicleId: string;
            let existingVehicle = typeof this.vehicleRepository.findByPlate === 'function'
                ? await this.vehicleRepository.findByPlate(plate, garageId)
                : null;
            let vehicleToSave: any = null;

            if (existingVehicle) {
                // REUSE & UPDATE
                vehicleId = existingVehicle.id!;
                const currentlySubscribed = existingVehicle.isSubscriber || (existingVehicle as any).is_subscriber;
                if (!currentlySubscribed && isSubscriber) {
                    vehicleToSave = { ...existingVehicle };
                    vehicleToSave.is_subscriber = true;
                    vehicleToSave.isSubscriber = true;
                }
            } else {
                // CREATE NEW
                vehicleId = uuidv4();
                if (garageId) {
                    vehicleToSave = {
                        id: vehicleId,
                        plate,
                        type: resolvedType,
                        garageId,
                        is_subscriber: isSubscriber,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                }
            }

            // 4. Generate Correlative Ticket Code (MOVED TO TRANSACTION)

            // 4.5. Resolve Prepaid / Anticipado Options
            let prepaidOptions: { isPrepaid: boolean; prepaidUntil: Date; prepaidTariffId: string; prepaidAmount: number; prepaidMovementId: string | null } | undefined;
            let prepaidAmount = 0;
            let prepaidTariffName = '';
            let prepaidMovement: any = null;
            const entryTime = new Date();

            if (prepaidTariffId) {
                if (!prepaidPaymentMethod || !prepaidInvoiceType) {
                    return res.status(400).json({ error: 'Faltan datos requeridos para el cobro anticipado (método de pago o tipo de factura).' });
                }

                // Lookup tariff in local DB
                const configRepo = new ConfigRepository();
                const tariffs = await configRepo.getTariffs(garageId);
                const tariff = tariffs.find((t: any) => t.id === prepaidTariffId || (t as any)._id === prepaidTariffId);

                if (!tariff || (tariff.type || '').toLowerCase() !== 'turno') {
                    return res.status(400).json({ error: 'La tarifa anticipada no existe o no es de tipo turno.' });
                }

                prepaidTariffName = tariff.name || 'Anticipado';
                const d = Number(tariff.days || 0);
                const h = Number(tariff.hours || 0);
                const m = Number(tariff.minutes || 0);
                const durationMs = (d * 86400000) + (h * 3600000) + (m * 60000);

                if (durationMs <= 0) {
                    return res.status(400).json({ error: 'La tarifa anticipada tiene una duración nula. No es válida para cobro anticipado.' });
                }

                const prepaidUntil = new Date(entryTime.getTime() + durationMs);

                // Lookup price from price matrix
                const methodNormalized = prepaidPaymentMethod.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const electronicMethods = ['transferencia', 'debito', 'credito', 'qr', 'mercadopago', 'mercado_pago'];
                const isElectronic = electronicMethods.includes(methodNormalized);
                
                const repoMethod = isElectronic ? 'electronic' : 'standard';
                const pricesForMethod = await configRepo.getPrices(garageId, repoMethod);
                
                const priceRecord = pricesForMethod.find((p: any) => p.tariffId === prepaidTariffId && p.vehicleTypeId === vehicleTypeId);
                prepaidAmount = priceRecord ? Number(priceRecord.amount || priceRecord.price || 0) : 0;

                const promoPercentage = Number(req.body.prepaidPromoPercentage || 0);
                if (promoPercentage > 0 && promoPercentage <= 100) {
                    prepaidAmount = prepaidAmount * (1 - promoPercentage / 100);
                }

                if (prepaidAmount <= 0 && promoPercentage !== 100) {
                    return res.status(400).json({ error: 'La tarifa anticipada seleccionada no posee un precio válido para este vehículo.' });
                }

                // Prepare Movement
                const ownerId = this.getGarageOwnerId(garageId);
                const ticketNumber = Number(Date.now().toString().slice(-9));
                
                prepaidMovement = {
                    id: uuidv4(),
                    garageId,
                    ownerId,
                    ticketNumber,
                    relatedEntityId: null, // Will be set after Stay generation
                    type: 'CobroEstadia' as const,
                    timestamp: entryTime,
                    amount: prepaidAmount,
                    paymentMethod: prepaidPaymentMethod,
                    operator: operator,
                    invoiceType: prepaidInvoiceType,
                    plate: plate,
                    notes: `Pago Anticipado - ${prepaidTariffName}`,
                    // receipt_number and ticket_code will be set inside the transaction
                    createdAt: new Date(),
                };

                prepaidOptions = {
                    isPrepaid: true,
                    prepaidUntil,
                    prepaidTariffId,
                    prepaidAmount,
                    prepaidMovementId: prepaidMovement.id
                };

                console.log(`⏱️ Entry: Prepaid validated for ${plate}. Tariff: ${prepaidTariffName}, Until: ${prepaidUntil.toISOString()}, Amount: $${prepaidAmount}`);
            }

            // 5. Process Entry (in memory)
            const entry = AccessManager.processEntry(
                plate,
                existingVehicle || ({ id: vehicleId } as any),
                null,
                isSubscriber,
                subscriptionId,
                undefined, // Ticket code will be assigned inside the transaction
                prepaidOptions,
                entryTime
            );

            // Patch linking details
            (entry as any).vehicleType = resolvedType;
            (entry as any).vehicleId = vehicleId;
            if (garageId) {
                (entry as any).garageId = garageId;
                const ownerId = this.getGarageOwnerId(garageId);
                if (ownerId) (entry as any).ownerId = ownerId;
            }

            // 🔓 HARDWARE: Explicitly reset/ensure hardware fields for new entry
              // --- ATTACHMENTS (Phase F) ---
              let processedPhotoPath = req.body.photoPath || null;
              if (processedPhotoPath && processedPhotoPath.startsWith('data:image')) {
                  processedPhotoPath = await AttachmentService.processBase64Attachment(
                      'stays',
                      entry.id,
                      'entry_photo_path',
                      processedPhotoPath,
                      'garage-photos',
                      `${garageId}/${entry.id}_entry.jpg`
                  );
              }

              Object.assign(entry as any, {
                  exit_authorized: false,
                  barrier_exit_used: false,
                  is_pending_processing: false,
                  anpr_suggested_plate: null,
                  entry_photo_path: processedPhotoPath,
                  exit_authorized_at: null,
                  barrier_exit_at: null
              });

            if (prepaidMovement) {
                prepaidMovement.relatedEntityId = entry.id;
            }

            // 6. Persist with atomic transaction
            let savedStay: any = entry;
            try {
                let __success = false;
            let __attempts = 0;
            while (!__success && __attempts < 3) {
                __attempts++;
                try {
                    await CorrelativeService.ensureStayLeaseAvailable(garageId);
                    if (prepaidMovement) await CorrelativeService.ensureMovementLeaseAvailable(garageId);
                    await TransactionHelper.runAsync(async (tx) => {
                    // Generate atomic Stay ticket code
                    const finalTicketCode = CorrelativeService.consumeStayTicketLocal(garageId, tx);
                    (entry as any).ticket_code = finalTicketCode;
                    (entry as any).ticketCode = finalTicketCode;
                    
                    savedStay = await this.stayRepository.save(entry as any, 'CREATE', tx);
                    
                    if (prepaidMovement) {
                        const nextCode = CorrelativeService.consumeMovementTicketLocal(garageId, tx);
                        prepaidMovement.ticket_code = nextCode;
                        prepaidMovement.receipt_number = nextCode;
                        await this.movementRepository.save(prepaidMovement as any, 'CREATE', tx);
                        console.log(`💰 Entry: Prepaid Movement saved for ${plate}. Amount: $${prepaidAmount}, Method: ${prepaidPaymentMethod}`);
                        (savedStay as any).prepaidMovement = prepaidMovement;
                    }

                    if (vehicleToSave && typeof this.vehicleRepository.save === 'function') {
                        await this.vehicleRepository.save(vehicleToSave, vehicleToSave.id ? 'UPDATE' : 'CREATE', tx);
                        console.log(`🚗 Entry: Vehicle ${vehicleId} saved/updated for ${plate}`);
                    }
                });
                    __success = true;
                } catch (err: any) {
                    if (err.message?.includes('LOCAL_LEASE_EXHAUSTED') && __attempts < 3) continue;
                    throw err;
                }
            }
            } catch (persistError) {
                console.error(`❌ Entry: Persistence error for ${plate}:`, persistError);
                return res.status(500).json({ error: 'Ocurrió un error al guardar la entrada en la base de datos.' });
            }

            if (prepaidMovement) {
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

            const activeSubscription = await this.subscriptionRepository.findActiveByPlate(plate, garageId);
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
            const ownerId = this.getGarageOwnerId(garageId);

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

            let __success2 = false;
            let __attempts2 = 0;
            while (!__success2 && __attempts2 < 3) {
                __attempts2++;
                try {
                    if (exitMovement) await CorrelativeService.ensureMovementLeaseAvailable(garageId);
                    await TransactionHelper.runAsync(async (tx) => {
                        await this.stayRepository.save(closedStay as any, 'UPDATE', tx);

                        if (exitMovement) {
                            // Inject correlative receipt_number and ticket_code atomically
                            const nextCode = CorrelativeService.consumeMovementTicketLocal(garageId, tx);
                            (exitMovement as any).receipt_number = nextCode;
                            (exitMovement as any).ticket_code = nextCode;
                            await this.movementRepository.save(exitMovement, 'CREATE', tx);
                        }
                    });
                    __success2 = true;
                } catch (err: any) {
                    if (err.message?.includes('LOCAL_LEASE_EXHAUSTED') && __attempts2 < 3) continue;
                    throw err;
                }
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

            const { price } = await AccessManager.quoteExit(
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

    static serializeStay(stay: any) {
        return {
            id: stay.id || stay._id,
            vehicleId: stay.vehicleId || stay.vehicle_id || null,
            plate: stay.plate,
            entryTime: stay.entryTime || stay.entry_time,
            exitTime: stay.exitTime || stay.exit_time || null,
            vehicleType: stay.vehicleType || stay.vehicle_type || 'Auto',
            active: stay.active ?? true,
            isPrepaid: Boolean(stay.isPrepaid || stay.is_prepaid),
            prepaidUntil: stay.prepaidUntil || stay.prepaid_until || null,
            prepaidTariffId: stay.prepaidTariffId || stay.prepaid_tariff_id || null,
            prepaidAmount: typeof stay.prepaidAmount === 'number' ? stay.prepaidAmount : (typeof stay.prepaid_amount === 'number' ? stay.prepaid_amount : null),
            prepaidMovementId: stay.prepaidMovementId || stay.prepaid_movement_id || null,
            // Mantener propiedades extras que el frontend pueda necesitar por ahora
            ticket_code: stay.ticket_code || stay.ticketCode,
            isSubscriber: Boolean(stay.isSubscriber || stay.is_subscriber),
            subscriptionId: stay.subscriptionId || stay.subscription_id || null,
            price: stay.price,
            isPrepaidCovered: stay.isPrepaidCovered,
            isGracePeriod: stay.isGracePeriod || stay.is_grace_period || false
        };
    }

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
            const feeResult = await AccessManager.quoteExit(stay as any, 'Efectivo', garageId, 0);
            (stay as any).price = feeResult.price;

            // Prepaid flags for frontend
            const stayIsPrepaid = (stay as any).isPrepaid === true || (stay as any).is_prepaid === true;
            const stayPrepaidUntil = (stay as any).prepaidUntil || (stay as any).prepaid_until;
            (stay as any).isPrepaid = stayIsPrepaid;
            
            if (stayIsPrepaid && stayPrepaidUntil) {
                const now = new Date();
                const validUntil = new Date(stayPrepaidUntil);
                if (!isNaN(validUntil.getTime()) && now <= validUntil) {
                    (stay as any).isPrepaidCovered = true;
                } else {
                    (stay as any).isPrepaidCovered = false;
                }
            } else {
                (stay as any).isPrepaidCovered = false;
            }

            // Evaluamos isGracePeriod basada puramente en la respuesta determinística del Engine
            (stay as any).isGracePeriod = feeResult.isGracePeriod;

            res.json(AccessController.serializeStay(stay));
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    getAllActiveStays = async (req: Request, res: Response) => {
        try {
            const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);

            // Pass garageId to repository
            const stays = await this.stayRepository.findAllActive(garageId);

            // Batch fetching vehicles to prevent N+1 query and correctly resolve isSubscriber
            const vehicleIds = stays.map(s => s.vehicleId || (s as any).vehicle_id).filter(Boolean);
            const plates = stays.filter(s => !(s.vehicleId || (s as any).vehicle_id)).map(s => s.plate).filter(Boolean);

            const query: any = { $or: [] };
            if (vehicleIds.length > 0) {
                query.$or.push({ id: { $in: vehicleIds } });
            }
            if (plates.length > 0) {
                const plateQuery: any = { plate: { $in: plates } };
                if (garageId) plateQuery.garageId = garageId;
                query.$or.push(plateQuery);
            }

            let vehicles: any[] = [];
            if (query.$or.length > 0) {
                if (StorageEngine.getEngine() === 'SQLITE') {
                    const sqliteDb = SQLiteManager.getInstance().getDatabase();
                    
                    // Get by IDs
                    if (vehicleIds.length > 0) {
                        const placeholders = vehicleIds.map(() => '?').join(',');
                        const rows = sqliteDb.prepare(`SELECT json_data FROM vehicles WHERE id IN (${placeholders})`).all(...vehicleIds) as any[];
                        vehicles.push(...rows.map((r: any) => JSON.parse(r.json_data)));
                    }
                    
                    // Get by Plates
                    if (plates.length > 0) {
                        const placeholders = plates.map(() => '?').join(',');
                        const params: any[] = [...plates];
                        let sql = `SELECT json_data FROM vehicles WHERE json_extract(json_data, '$.plate') IN (${placeholders})`;
                        if (garageId) {
                            sql += ` AND (json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?)`;
                            params.push(garageId, garageId);
                        }
                        const rows = sqliteDb.prepare(sql).all(...params) as any[];
                        
                        const existingIds = new Set(vehicles.map(v => v.id));
                        const newVehicles = rows.map((r: any) => JSON.parse(r.json_data)).filter((v: any) => !existingIds.has(v.id));
                        vehicles.push(...newVehicles);
                    }
                } else {
                    vehicles = await db.vehicles.find(query);
                }
            }

            const vehiclesById = new Map(vehicles.map(v => [v.id, v]));
            const vehiclesByPlate = new Map(vehicles.map(v => [v.plate, v]));

            const populatedStays = stays.map((stay) => {
                const vId = stay.vehicleId || (stay as any).vehicle_id;
                let vehicle = vId ? vehiclesById.get(vId) : vehiclesByPlate.get(stay.plate);
                
                // Fallback check if garageId matches for plate lookup
                if (!vId && vehicle && vehicle.garageId !== garageId) {
                    vehicle = undefined;
                }

                if (vehicle) {
                    stay.vehicleId = vehicle.id;
                    const subStatus = Boolean(vehicle.is_subscriber || vehicle.isSubscriber);
                    (stay as any).isSubscriber = subStatus;
                    (stay as any).is_subscriber = subStatus; // Overwrite original field to prevent serializeStay fallback
                    (stay as any).vehicleType = vehicle.type || stay.vehicleType || (stay as any).vehicle_type || 'Auto';
                } else {
                    (stay as any).vehicleType = stay.vehicleType || (stay as any).vehicle_type || 'Auto';
                }

                return AccessController.serializeStay(stay);
            });

            res.json(populatedStays);
        } catch (error: any) {
            console.error('Error fetching stays:', error);
            res.status(500).json({ error: error.message });
        }
    }

    getAllMovements = async (req: Request, res: Response) => {
        try {
            const garageId = (req.headers['x-garage-id'] as string) || (req.query.garageId as string);
            let movements = await this.movementRepository.findAll();
            if (garageId) {
                movements = movements.filter(m => m.garageId === garageId || (m as any).garage_id === garageId);
            }
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
