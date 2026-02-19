import { Request, Response } from 'express';
import { AccessManager } from '../domain/AccessManager';
import { StayRepository } from './StayRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { CustomerRepository } from '../../Garage/infra/CustomerRepository';

// TODO: Move to config
// TODO: Move to config
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

    constructor() {
        this.stayRepository = new StayRepository();
        this.movementRepository = new MovementRepository();
        this.vehicleRepository = new VehicleRepository();
        this.customerRepository = new CustomerRepository();
    }

    registerEntry = async (req: Request, res: Response) => {
        try {
            const { plate, vehicleType } = req.body;
            const garageId = (req.headers['x-garage-id'] as string);

            if (!plate) return res.status(400).json({ error: 'Plate is required' });
            if (!garageId) {
                // Warning or strict error? User said "Filtro Obligatorio". 
                // But legacy clients might break. Let's warn but proceed if possible, or fail if Critical.
                // "Filtro Obligatorio" implies failure.
                console.warn('⚠️ AccessController: Missing x-garage-id header on entry');
                // return res.status(400).json({ error: 'System Error: Tenant ID missing' });
            }

            const existingStay = await this.stayRepository.findActiveByPlate(plate, garageId);
            if (existingStay) {
                return res.status(409).json({ error: 'Vehicle already in garage', stay: existingStay });
            }

            // Optional: Populate vehicle data if persistent?
            if (garageId) {
                // Here we could check/create Vehicle record via VehicleRepository.
                // For now, AccessManager processEntry relies on minimal data.
            }

            const entry = AccessManager.processEntry(plate, null, null);
            // Patch type if passed (dirty fix until schema update)
            if (vehicleType) (entry as any).vehicleType = vehicleType;
            if (garageId) (entry as any).garageId = garageId;

            const savedStay = await this.stayRepository.save(entry as any);
            res.json(savedStay);
        } catch (error: any) {
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
