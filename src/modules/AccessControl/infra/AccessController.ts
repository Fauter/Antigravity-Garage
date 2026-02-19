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

interface MatrixData {
    id?: string;
    _id?: string;
    values: any; // The matrix
}

interface VehicleTypeData {
    id?: string;
    _id?: string;
    name: string;
    hora: boolean;
    mensual: boolean;
}

const pricingDB = new JsonDB<MatrixData>('prices');
// const vehicleDB = new JsonDB<VehicleTypeData>('vehicleTypes'); // REMOVED: Replaced by NeDB

// Helper to get Matrix
const getPricingMatrix = async () => {
    const all = await pricingDB.getAll();
    if (all.length > 0) return all[0].values;
    // Fallback if empty (should be seeded)
    return {};
};

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
            const { plate, vehicleTypeId } = req.body;
            const garageId = (req.headers['x-garage-id'] as string);

            if (!plate) return res.status(400).json({ error: 'Plate is required' });
            if (!garageId) {
                console.warn('⚠️ AccessController: Missing x-garage-id header on entry');
            }

            // 0. Check for existing Active Stay (Prevent Double Entry)
            const existingStay = await this.stayRepository.findActiveByPlate(plate, garageId);
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
                // Update isSubscriber status if changed
                if (existingVehicle.isSubscriber !== isSubscriber) {
                    existingVehicle.isSubscriber = isSubscriber;
                    await this.vehicleRepository.save(existingVehicle);
                    console.log(`🚗 Entry: Updated Vehicle ${vehicleId} subscriber status to ${isSubscriber}`);
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
                        isSubscriber, // Persist status
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    } as any);
                    console.log(`🆕 Entry: Created new vehicle ${vehicleId} for ${plate} (Subscriber: ${isSubscriber})`);
                }
            }

            // 4. Process Entry
            const entry = AccessManager.processEntry(
                plate,
                existingVehicle || ({ id: vehicleId } as any),
                null,
                isSubscriber,
                subscriptionId
            );

            // Patch linking details
            (entry as any).vehicleType = resolvedType;
            (entry as any).vehicleId = vehicleId;
            if (garageId) (entry as any).garageId = garageId;

            const savedStay = await this.stayRepository.save(entry as any);
            res.json(savedStay);
        } catch (error: any) {
            console.error('Entry Error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    registerExit = async (req: Request, res: Response) => {
        try {
            const { plate, paymentMethod, operator, invoiceType } = req.body;
            const garageId = (req.headers['x-garage-id'] as string);

            if (!plate) return res.status(400).json({ error: 'Plate is required' });

            const stay = await this.stayRepository.findActiveByPlate(plate, garageId);
            if (!stay) {
                return res.status(404).json({ error: 'No active stay found for plate' });
            }

            // 🔍 Phase 2: Re-validate Subscription Link on Exit
            const activeSubscription = await this.subscriptionRepository.findActiveByPlate(plate);
            const isSubscriber = !!activeSubscription;

            // Override stay status based on CURRENT validity
            stay.isSubscriber = isSubscriber;
            stay.subscriptionId = activeSubscription ? activeSubscription.id : null;

            if (isSubscriber) {
                console.log(`💎 Exit: Verified Active Subscription for ${plate} (ID: ${stay.subscriptionId})`);
            } else if (stay.isSubscriber && !isSubscriber) {
                console.warn(`⚠️ Exit: Subscription Expired or Invalid for ${plate}. Charging normal price.`);
            }

            // Matrix is now handled internally by PricingEngine -> Repositories
            // const matrix = await getPricingMatrix();

            // Metadata Injection
            const userOperator = (operator && operator !== 'undefined undefined') ? operator : 'Sistema';

            // Fetch Owner ID from Garage Config (if available)
            let ownerId: string | undefined;
            if (garageId) {
                // Now db.garages exists
                const garage: any = await db.garages.findOne({ id: garageId });
                if (garage) ownerId = garage.owner_id || garage.ownerId;
            }

            // Generate Ticket Number (Numeric: last 9 digits of timestamp)
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
                ticketNumber
            );

            await this.stayRepository.save(closedStay as any);
            await this.movementRepository.save(exitMovement);

            // 🚀 SYNC: Enqueue Changes for Cloud
            try {
                // Fix: Strip internal _id to prevent conflicts during Sync/Upsert
                const { _id: sId, ...stayPayload } = closedStay as any;
                const { _id: mId, ...movementPayload } = exitMovement as any;

                await db.mutations.insert({
                    id: uuidv4(),
                    entityType: 'Stay',
                    operation: 'UPDATE',
                    entityId: closedStay.id,
                    payload: stayPayload,
                    timestamp: new Date(),
                    synced: false
                });

                await db.mutations.insert({
                    id: uuidv4(),
                    entityType: 'Movement',
                    operation: 'CREATE',
                    entityId: exitMovement.id,
                    payload: movementPayload,
                    timestamp: new Date(),
                    synced: false
                });
                console.log(`📡 Exit: Queued mutations for Stay ${closedStay.id} and Movement ${exitMovement.id}`);
            } catch (syncErr) {
                console.error('⚠️ Exit: Failed to queue mutations via AccessController', syncErr);
                // Non-blocking: We proceed to respond success to frontend
            }

            res.json({ stay: closedStay, movement: exitMovement, price });
        } catch (error: any) {
            console.error('Exit error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    getActiveStay = async (req: Request, res: Response) => { /* ... */
        try {
            const { plate } = req.params;
            const stay = await this.stayRepository.findActiveByPlate(String(plate));
            if (!stay) return res.status(404).json({ error: 'Stay not found' });
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
            const { VehicleModel } = await import('../../Garage/infra/models.js').catch(() => ({ VehicleModel: null })) as any;
            // Fallback to real path
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

    // --- Configuration Endpoints ---

    // Prices (Matrix)
    getPrices = async (req: Request, res: Response) => {
        try {
            const matrix = await getPricingMatrix();
            res.json(matrix);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    savePrices = async (req: Request, res: Response) => {
        try {
            const newMatrix = req.body; // Expects { "Auto": { ... } }

            // Update the single record
            const all = await pricingDB.getAll();
            if (all.length > 0) {
                const id = all[0].id || all[0]._id;
                await pricingDB.updateOne({ id } as any, { values: newMatrix });
            } else {
                await pricingDB.create({ values: newMatrix });
            }
            res.json({ message: 'Precios guardados' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    // Vehicle Types
    getVehicleTypes = async (req: Request, res: Response) => {
        try {
            const garageId = (req.headers['x-garage-id'] as string);
            // Fetch from NeDB directly
            const types = await db.vehicleTypes.find({ garageId });
            res.json(types);
        } catch (error: any) {
            console.error('Error getting vehicle types from NeDB:', error);
            res.status(500).json({ error: error.message });
        }
    }

    saveVehicleType = async (req: Request, res: Response) => {
        try {
            const garageId = (req.headers['x-garage-id'] as string);
            // Add new type
            const data = req.body; // { name, hora, mensual }
            if (!data.name) return res.status(400).json({ error: 'Name is required' });

            // Ensure garageId is saved
            const typeToSave = { ...data, garageId };

            // Use NeDB
            await db.vehicleTypes.insert(typeToSave);
            res.json({ message: 'Tipo creado' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    deleteVehicleType = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            // Use NeDB
            await db.vehicleTypes.remove({ id: id }, {});
            res.json({ message: 'Tipo eliminado (si existía)' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}
