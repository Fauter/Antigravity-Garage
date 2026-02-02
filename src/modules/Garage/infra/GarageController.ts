import { Request, Response } from 'express';
import { SubscriptionManager } from '../domain/SubscriptionManager';
import { SubscriptionRepository } from './SubscriptionRepository';
import { CustomerRepository } from './CustomerRepository';
import { VehicleRepository } from './VehicleRepository';
import { v4 as uuidv4 } from 'uuid';

// TODO: Move to shared config / PricingEngine
const PRICING_CONFIG = {
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
};

export class GarageController {
    private subscriptionRepo: SubscriptionRepository;
    private customerRepo: CustomerRepository;
    private vehicleRepo: VehicleRepository;

    constructor() {
        this.subscriptionRepo = new SubscriptionRepository();
        this.customerRepo = new CustomerRepository();
        this.vehicleRepo = new VehicleRepository();
    }

    createSubscription = async (req: Request, res: Response) => {
        try {
            const { customerData, vehicleData, subscriptionType, paymentMethod } = req.body;

            // 1. Process Customer (Find or Create)
            let customer = await this.customerRepo.findByDni(customerData.dni);
            if (!customer) {
                customer = {
                    id: uuidv4(),
                    ...customerData,
                    firstName: customerData.nombreApellido, // Mapping hack for now
                    lastName: '', // TODO: split name
                    dni: customerData.dni,
                    email: customerData.email,
                    phone: customerData.telefono,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                await this.customerRepo.save(customer!);
            }

            // 2. Process Vehicle
            let vehicle = await this.vehicleRepo.findByPlate(vehicleData.plate);
            if (!vehicle) {
                vehicle = {
                    id: uuidv4(),
                    customerId: customer!.id,
                    plate: vehicleData.plate,
                    type: vehicleData.type, // 'Auto' | 'Moto'
                    // Removed brand/model as per schema strictness
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                await this.vehicleRepo.save(vehicle!);
            }

            // 3. Create Subscription Domain Object
            // Use findByCustomerId instead of findActiveByCustomer (which might strictly mean active)
            // But manager expects activeSubscriptions to check collision.
            // Repo has findByCustomerId which returns array. We filter active manually if needed or trust Repo.
            const customerSubs = await this.subscriptionRepo.findByCustomerId(customer!.id);
            const activeSubs = customerSubs.filter(s => s.active);

            const newSubscription = SubscriptionManager.createSubscription(
                customer!.id,
                subscriptionType, // 'Mensual', etc.
                new Date(), // Start Date (Now)
                activeSubs,
                PRICING_CONFIG, // TODO: Real config
                vehicle,
                new Date(),
                paymentMethod
            );

            // 4. Persist
            const savedSub = await this.subscriptionRepo.save(newSubscription);

            res.json(savedSub);
        } catch (error: any) {
            console.error('Subscription Create Error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    getAllSubscriptions = async (req: Request, res: Response) => {
        try {
            // TODO: Implement getAll in Repo or use simplified find
            // For now, returning empty or basic find
            // We need to extend the repo to support listing ALL
            res.json([]);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    reset = async () => {
        await this.subscriptionRepo.reset();
        // Maybe reset customerRepo/vehicleRepo too? The prompt specifically mentioned "estadias, movements, abonos"
        // I'll assume customer/vehicle data survives? Or should I clear them?
        // User prompt: "Borra estadías, movimientos y abonos. Mantiene usuarios." -> Implicitly might keep Customers/Vehicles or not?
        // "Files to reset = ['estadias.json', 'movements.json', 'abonos.json']"
        // So I will ONLY reset subscriptionRepo here.
    }
}
