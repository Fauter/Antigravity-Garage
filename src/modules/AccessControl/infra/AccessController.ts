import { Request, Response } from 'express';
import { AccessManager } from '../domain/AccessManager';
import { StayRepository } from './StayRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { CustomerRepository } from '../../Garage/infra/CustomerRepository';
import { SubscriptionRepository } from '../../Garage/infra/SubscriptionRepository';

import { JsonDB } from '../../../infrastructure/database/json-db';
import { v4 as uuidv4 } from 'uuid';

interface MatrixData {
    id?: string;
    _id?: string;
    values: any; // The matrix
}

interface VehicleTypeData {
    id?: string;
    _id?: string;
    nombre: string;
    hora: boolean;
    mensual: boolean;
}

const pricingDB = new JsonDB<MatrixData>('prices');
const vehicleDB = new JsonDB<VehicleTypeData>('vehicleTypes');

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
            const { plate, vehicleType } = req.body;
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

            // 1. Resolve Vehicle Type (UUID -> Name)
            let resolvedType = 'Auto'; // Default
            if (vehicleType) {
                if (vehicleType.length > 20) {
                    const allTypes = await vehicleDB.getAll();
                    const found = allTypes.find(t => t.id === vehicleType || t._id === vehicleType);
                    if (found) {
                        resolvedType = found.nombre;
                    }
                } else {
                    resolvedType = vehicleType;
                }
            }
            // Map for Supabase Compliance
            if (resolvedType === 'Camioneta') resolvedType = 'PickUp';
            if (resolvedType === 'Automovil') resolvedType = 'Auto';

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

            // Pass to Manager (async)
            const { closedStay, exitMovement, price } = await AccessManager.processExit(
                stay as any,
                new Date(),
                paymentMethod as any,
                operator,
                invoiceType
            );

            await this.stayRepository.save(closedStay as any);
            await this.movementRepository.save(exitMovement);

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
            const types = await vehicleDB.getAll();
            res.json(types);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    saveVehicleType = async (req: Request, res: Response) => {
        try {
            // Add new type
            const data = req.body; // { nombre, hora, mensual }
            if (!data.nombre) return res.status(400).json({ error: 'Nombre es requerido' });

            await vehicleDB.create(data);
            res.json({ message: 'Tipo creado' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    deleteVehicleType = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const deleted = await vehicleDB.delete(String(id));
            if (deleted) {
                res.json({ message: 'Tipo eliminado' });
            } else {
                res.status(404).json({ error: 'Tipo no encontrado' });
            }
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}
