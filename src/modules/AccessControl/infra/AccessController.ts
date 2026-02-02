import { Request, Response } from 'express';
import { AccessManager } from '../domain/AccessManager';
import { StayRepository } from './StayRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { CustomerRepository } from '../../Garage/infra/CustomerRepository';

// TODO: Move to config
// TODO: Move to config
const ACCESS_CONFIG = {
    tarifas: {
        auto_hora: 3000,
        moto_hora: 2000,
        camioneta_hora: 4000,
        tolerancia: 15,
        estadia_24h_auto: 15000,
        mensual: {
            Exclusiva: { Efectivo: 50000, MercadoPago: 55000 },
            Fija: { Efectivo: 40000, MercadoPago: 44000 },
            Movil: { Efectivo: 30000, MercadoPago: 33000 }
        },
        mora: {
            nivel1: 1000,
            nivel2: 2000
        }
    },
    hourlyRate: 3000 // Default generic
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

            // 1. Check if already inside
            const existingStay = await this.stayRepository.findActiveByPlate(plate);
            if (existingStay) {
                return res.status(409).json({ error: 'Vehicle already in garage', stay: existingStay });
            }

            // 2. Find/Create Vehicle (Optional logic, can use minimal vehicle)
            // For now, we assume simple entry.
            // In a full flow, we might fetch vehicle from DB.
            const entry = AccessManager.processEntry(plate, null, null);

            // 3. Save Stay
            const savedStay = await this.stayRepository.save(entry as any);

            res.json(savedStay);
        } catch (error: any) {
            console.error('Entry error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    registerExit = async (req: Request, res: Response) => {
        try {
            const { plate, paymentMethod, operator } = req.body;
            if (!plate) return res.status(400).json({ error: 'Plate is required' });

            // 1. Find Active Stay
            const stay = await this.stayRepository.findActiveByPlate(plate);
            if (!stay) {
                return res.status(404).json({ error: 'No active stay found for plate' });
            }

            // 2. Process Exit
            const method = (typeof paymentMethod === 'string' ? paymentMethod : 'Efectivo') as any;
            const { closedStay, exitMovement, price } = AccessManager.processExit(
                stay,
                new Date(),
                ACCESS_CONFIG,
                method,
                operator // Pass operator
            );

            // 3. Persist Changes
            await this.stayRepository.save(closedStay as any);
            await this.movementRepository.save(exitMovement);

            res.json({ stay: closedStay, movement: exitMovement, price });
        } catch (error: any) {
            console.error('Exit error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    // Optional: Get active stay info (price preview)
    getActiveStay = async (req: Request, res: Response) => {
        try {
            const { plate } = req.params;
            const stay = await this.stayRepository.findActiveByPlate(String(plate));
            if (!stay) return res.status(404).json({ error: 'Stay not found' });
            res.json(stay);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    // List all active stays for audit requests
    getAllActiveStays = async (req: Request, res: Response) => {
        try {
            const stays = await this.stayRepository.findAllActive();
            res.json(stays);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    // New: List all movements (cobros)
    getAllMovements = async (req: Request, res: Response) => {
        try {
            // In a real app we might filter by date here via query params
            // For now, return all and filter in frontend or implement simple filtering
            const movements = await this.movementRepository.findAll();
            res.json(movements);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    reset = async () => {
        // Need to reset all repos this controller uses
        // StayRepository needs a reset method (via JsonDB)
        // MovementRepository already has it
        await this.stayRepository.reset();
        await this.movementRepository.reset();
    }
}
