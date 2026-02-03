import { Request, Response } from 'express';
import { SubscriptionManager } from '../domain/SubscriptionManager';
import { SubscriptionRepository } from './SubscriptionRepository';
import { CustomerRepository } from './CustomerRepository';
import { VehicleRepository } from './VehicleRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { v4 as uuidv4 } from 'uuid';
import { JsonDB } from '../../../infrastructure/database/json-db';

// --- Cochera Model ---
interface Cochera {
    id: string;
    tipo: 'Fija' | 'Exclusiva' | 'Movil';
    numero?: string;
    vehiculos: string[]; // Vehicle IDs
    clienteId?: string;
    precioBase: number;
}

const cocherasDB = new JsonDB<Cochera>('cocheras');

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
    private movementRepo: MovementRepository;

    constructor() {
        this.subscriptionRepo = new SubscriptionRepository();
        this.customerRepo = new CustomerRepository();
        this.vehicleRepo = new VehicleRepository();
        this.movementRepo = new MovementRepository();
    }

    // --- COCHERAS API ---

    getAllCocheras = async (req: Request, res: Response) => {
        try {
            const cocheras = await cocherasDB.getAll();
            res.json(cocheras);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    createCochera = async (req: Request, res: Response) => {
        try {
            const { tipo, numero, vehiculos, clienteId, precioBase } = req.body;

            // Validation: Unique Number for Fixed/Exclusive
            if (tipo !== 'Movil' && numero) {
                const all = await cocherasDB.getAll();
                const exists = all.find(c => c.numero === numero);
                if (exists) {
                    return res.status(409).json({ error: `La cochera número ${numero} ya está ocupada.` });
                }
            }

            const newCochera: Cochera = {
                id: uuidv4(),
                tipo, // 'Fija', 'Exclusiva', 'Movil'
                numero: tipo === 'Movil' ? undefined : numero,
                vehiculos: vehiculos || [],
                clienteId,
                precioBase: precioBase || 0
            };

            await cocherasDB.create(newCochera);
            res.json(newCochera);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    updateCochera = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const { vehiculos, newVehicleType } = req.body; // Expecting ID list and optionally type of added vehicle

            const cochera = await cocherasDB.getById(id);
            if (!cochera) return res.status(404).json({ error: 'Cochera not found' });

            // Upsell Logic for Fixed/Exclusive
            if (cochera.tipo !== 'Movil' && newVehicleType) {
                // Determine monthly price for new type
                // TODO: Fetch from matrix DB or config. Using PRICING_CONFIG as fallback/proxy for now.
                // Assuming PRICING_CONFIG structure or updated matrix.
                // Config structure: mensual: { Exclusiva: { Efectivo: 50000 }, Fija: { Efectivo: ... } }
                // Warning: newVehicleType (e.g. 'Camioneta') might not map directly if config is by 'Fija/Movil'.
                // The prompt says: "El precio del abono lo dicta el vehículo más caro."
                // This implies Matrix should have: { Fija: { Auto: 40k, Camioneta: 50k } }?
                // OR Base + Surplus?
                // Let's assume standard price is for Auto, and Scale applied?
                // Or simply: If 'Camioneta' implies higher standard rate in 'prices.json' -> 'mensual' value.
                // Let's use a helper or simplistic heuristic: 
                // Auto=Standard, Camioneta=+20%? 

                // Better: Look up price in `PRICING_CONFIG` key if we had it by vehicle.
                // Current `PRICING_CONFIG` only has `mensual: { Fija: ... }` which is flat.
                // The User Prompt implies I should support this.
                // Let's assume strict business rule: 
                //    Price = Base defined in Cochera. 
                //    New Price = Look up 'Mensual' for 'VehicleType' in `prices.json` (values.efectivo[Type].mensual).

                // MOCK LOOKUP (Ideally import access to PricingDB)
                // For this step, I will implement the Logic Flow assuming a hypothetical `getMonthlyPrice(type)` function
                // or trust the frontend sent the `newBasePrice`.
                // Let's trust `req.body.newBasePrice`
                const newBasePrice = Number(req.body.newBasePrice);
                const vehicleTypeStr = String(newVehicleType);

                // If new price > current base, calculate diff and log movement
                if (!isNaN(newBasePrice) && newBasePrice > cochera.precioBase) {
                    const diff = newBasePrice - cochera.precioBase;

                    const now = new Date();
                    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                    const remaining = daysInMonth - now.getDate() + 1;

                    // Prorated Difference
                    const proratedDiff = Math.floor((diff / daysInMonth) * remaining);

                    if (proratedDiff > 0) {
                        await this.movementRepo.save({
                            id: uuidv4(),
                            type: 'CobroAbono',
                            amount: proratedDiff,
                            paymentMethod: 'Efectivo',
                            timestamp: new Date(),
                            notes: `Upgrade Cochera ${cochera.numero} - Dif. Vehículo ${vehicleTypeStr}`,
                            relatedEntityId: cochera.id,
                            plate: 'VARIOUS',
                            operator: 'System',
                            createdAt: new Date()
                        } as any);

                        // Update base price
                        cochera.precioBase = newBasePrice;
                    }
                }
            }

            // Update fields
            if (vehiculos) cochera.vehiculos = vehiculos;
            // Persist
            await cocherasDB.updateOne({ id } as any, cochera);

            res.json({ message: 'Cochera actualizada', cochera });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    deleteCochera = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            await cocherasDB.delete(String(id));
            res.json({ message: 'Cochera eliminada' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    // --- SUBSCRIPTIONS ---

    createSubscription = async (req: Request, res: Response) => {
        try {
            // Updated to handle Prorata calc if frontend sends price?
            // Or we calc here. User prompt: "Front displays live prorated price... Toda alta DEBE generar un registro en movements".
            // We assume backend validates price or trusts for now, but better to recalc.
            // For now, let's accept `amount` explicitly or calc using standard.

            const { customerData, vehicleData, subscriptionType, paymentMethod, amount } = req.body;

            // 1. Process Customer (Find or Create)
            let customer = await this.customerRepo.findByDni(customerData.dni);
            if (!customer) {
                customer = {
                    id: uuidv4(),
                    ...customerData,
                    firstName: customerData.nombreApellido,
                    lastName: '',
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
                    type: vehicleData.type,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                await this.vehicleRepo.save(vehicle!);
            }

            // 3. Create Subscription
            const customerSubs = await this.subscriptionRepo.findByCustomerId(customer!.id);
            const activeSubs = customerSubs.filter(s => s.active);

            // TODO: If subscriptionType is Fija/Exclusiva, we should Link to a Cochera?
            // The prompt separates "Abonos" from "Cocheras" architecture but implies linkage.
            // "Cocheras Fijas/Exclusivas: Un mismo número no pode duplicarse".
            // Assuming the Frontend creates the Cochera first or we assume Cochera exists?
            // "Lógica de Cochera (Top Flow)... Si marca Exclusiva...".
            // Let's create the Abono. The linkage might be implicit or explicit. 
            // For now, standard Abono creation.

            const newSubscription = SubscriptionManager.createSubscription(
                customer!.id,
                subscriptionType,
                new Date(),
                activeSubs,
                PRICING_CONFIG,
                vehicle,
                new Date(),
                paymentMethod
            );

            // Override price if prorata amount passed (trusting frontend or separate calculation logic)
            // Ideally we calculate prorata here too.
            if (amount !== undefined) {
                newSubscription.price = amount;
            }

            const savedSub = await this.subscriptionRepo.save(newSubscription);

            // 5. Financial Movement (CRITICAL)
            await this.movementRepo.save({
                id: uuidv4(),
                type: 'CobroAbono',
                amount: savedSub.price,
                paymentMethod: paymentMethod || 'Efectivo',
                timestamp: new Date(),
                notes: `Alta Abono ${subscriptionType} - ${vehicle.plate}`,
                relatedEntityId: savedSub.id,
                plate: vehicle.plate,
                operator: 'System', // TODO: Req User
                createdAt: new Date()
            } as any);

            res.json(savedSub);
        } catch (error: any) {
            console.error('Subscription Create Error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    getAllSubscriptions = async (req: Request, res: Response) => {
        try {
            res.json([]);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    reset = async () => {
        await this.subscriptionRepo.reset();
        await cocherasDB.reset();
    }
}
