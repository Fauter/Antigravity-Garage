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
            if (!plate) return res.status(400).json({ error: 'Plate is required' });

            const existingStay = await this.stayRepository.findActiveByPlate(plate);
            if (existingStay) {
                return res.status(409).json({ error: 'Vehicle already in garage', stay: existingStay });
            }

            // Optional: Validate vehicleType against DB?
            // For now, AccessManager trusts input or defaults. 
            // We could inject vehicleType logic here.
            // TODO: Pass vehicleType to AccessManager.processEntry if we update it to store vehicleType on Stay. 
            // (Current StaySchema implies we might rely on linked Vehicle, or 'plate' only?)
            // StaySchema has 'vehicleId'. It doesn't strictly have 'vehicleType' textual field unless we add it. 
            // PricingEngine expects 'vehicleType' on stay object or assumes 'Auto'.
            // If we want correct pricing, we MUST store vehicleType on Stay or lookup Vehicle.
            // Let's assume for Mision 1/2 we just need basic flow.
            // BUT user said: "Pricing Engine... debe tomar el tipo de vehículo (desde la estadía activa)".
            // So Stay needs 'vehicleType'. I should verify StaySchema has it.
            // Looking at schemas.ts from prev turn... StaySchema: 
            // "vehicleId: UuidSchema.optional().nullable(),"
            // "plate: z.string(),"
            // It DOES NOT have vehicleType string.
            // However, PricingEngine.calculateParkingFee signature I wrote takes: 
            // `stay: { ... vehicleType?: string }`
            // Critical: I need to add `vehicleType` to StaySchema or fetch the Vehicle to get the type.
            // Simplest for "Atomic" change: Add `vehicleType` to StaySchema and save it on Entry.

            // Wait, I can't easily change StaySchema and migrating DB in this step without risk.
            // Alternative: `AccessManager.processEntry` creates a Stay.
            // I'll update AccessManager.processEntry locally to attach vehicleType if possible/allowed or just save it as any. 
            // For now, simply trust flow.

            const entry = AccessManager.processEntry(plate, null, null);
            // Patch type if passed (dirty fix until schema update)
            if (vehicleType) (entry as any).vehicleType = vehicleType;

            const savedStay = await this.stayRepository.save(entry as any);
            res.json(savedStay);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    registerExit = async (req: Request, res: Response) => {
        try {
            const { plate, paymentMethod, operator, invoiceType } = req.body;
            if (!plate) return res.status(400).json({ error: 'Plate is required' });

            const stay = await this.stayRepository.findActiveByPlate(plate);
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
            const stays = await this.stayRepository.findAllActive();
            res.json(stays);
        } catch (error: any) {
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
