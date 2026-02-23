import { v4 as uuidv4 } from 'uuid';
import {
    Movement,
    Vehicle,
    Customer,
    MovementSchema,
    Stay,
    StaySchema
} from '../../../shared/schemas';
import { PricingEngine } from '../../Billing/domain/PricingEngine';
import { db } from '../../../infrastructure/database/datastore';

export class AccessManager {
    /**
     * Registra la entrada de un vehículo.
     * Crea un registro de Estancia (Stay).
     */
    static processEntry(
        plate: string,
        vehicle?: Vehicle | null,
        customer?: Customer | null,
        isSubscriber: boolean = false,
        subscriptionId?: string | null
    ): Stay {
        const entryStay: Stay = {
            id: uuidv4(),
            plate: plate.toUpperCase(),
            vehicleId: vehicle ? vehicle.id : null,
            entryTime: new Date(),
            active: true,
            isSubscriber,
            subscriptionId: subscriptionId || null,

            createdAt: new Date(),
        };

        return StaySchema.parse(entryStay);
    }

    /**
     * Registra la salida.
     * Calcula el cobro usando PricingEngine si corresponde.
     * Cierra el Stay y genera un Movement (CobroEstadia).
     */
    static async processExit(
        stay: Stay,
        exitDate: Date,
        paymentMethod: 'Efectivo' | 'Transferencia' | 'Debito' | 'Credito' | 'QR' = 'Efectivo',
        operator?: string,
        invoiceType?: 'A' | 'B' | 'C' | 'CC' | 'Final',
        garageId?: string,
        ownerId?: string,
        ticketNumber?: number
    ): Promise<{ closedStay: Stay; exitMovement: Movement | null; price: number }> {
        if (!stay.active) {
            throw new Error('La estancia ya está cerrada.');
        }

        // Ensure garageId is available (from stay or arg)
        const finalGarageId = garageId || (stay as any).garageId;
        if (!finalGarageId) console.warn('⚠️ AccessManager: Stay missing garageId, pricing might fail.');

        // Direct DB Access for Pricing (Unified Logic with routes.ts)
        // We bypass ConfigRepo to ensure we read exactly what is in the local NeDB
        const priceRepo = {
            getPrices: async (method: string) => {
                const listFilter = (method === 'EFECTIVO') ? 'standard' : 'electronic';

                // Fetch from Local DB
                const prices: any[] = await db.prices.find({ garageId: finalGarageId, priceList: listFilter });
                const schemas: any[] = await db.vehicleTypes.find({ garageId: finalGarageId });
                const tariffs: any[] = await db.tariffs.find({ garageId: finalGarageId });

                const matrix: any = {};
                const vMap = new Map(schemas.map((v: any) => [v.id, v.name]));
                const tMap = new Map(tariffs.map((t: any) => [t.id, t.name]));

                prices.forEach((p: any) => {
                    const vId = p.vehicleTypeId || p.vehicle_type_id;
                    const tId = p.tariffId || p.tariff_id;
                    const vName = vMap.get(vId);
                    const tName = tMap.get(tId);

                    if (vName && tName) {
                        if (!matrix[vName]) matrix[vName] = {};
                        matrix[vName][tName] = Number(p.amount);
                    }
                });
                console.log("Matriz Generada para Engine (Direct DB):", JSON.stringify(matrix));
                return matrix;
            }
        };

        // Mock Repos (Engine only needs getAll/getParams)
        const tariffRepo = { getAll: () => db.tariffs.find({ garageId: finalGarageId }) };
        const paramRepo = { getParams: async () => ({ toleranciaInicial: 15, fraccionarDesde: 0 }) }; // Default for now, or fetch from db.params if exists

        const engine = new PricingEngine(tariffRepo as any, paramRepo as any, priceRepo);

        // 1. Calculate Price & Handle Subscriber Scenario
        let price = 0;
        let notes = '';

        const closedStay: Stay = {
            ...stay,
            active: false,
            exitTime: exitDate
        };

        if ((stay as any).is_subscriber || stay.isSubscriber) {
            price = 0;
            notes = `Salida Abonado - (ID: ${stay.subscriptionId?.slice(0, 8) || 'N/A'})`;
            console.log(`💎 Exit: Subscriber Departure for ${stay.plate}. Movement Skipped.`);

            return {
                closedStay: StaySchema.parse(closedStay),
                exitMovement: null, // Abonados no generan movimiento contable (está prepagado en /abonos)
                price: 0
            };
        }

        // NON-SUBSCRIBER LOGIC:
        price = await engine.calculateParkingFee(
            stay,
            exitDate,
            paymentMethod
        );

        // Calculate Duration for Notes
        const durationMs = exitDate.getTime() - new Date(stay.entryTime).getTime();
        const durationMin = Math.ceil(durationMs / 60000);
        const hours = Math.floor(durationMin / 60);
        const mins = durationMin % 60;
        const timeString = `${hours}:${mins.toString().padStart(2, '0')}hs`;

        notes = `Por ${timeString}`;

        const exitMovement: Movement = {
            id: uuidv4(),
            garageId: finalGarageId,
            ownerId: ownerId,
            ticketNumber: ticketNumber,
            relatedEntityId: stay.id,
            type: 'CobroEstadia',
            timestamp: exitDate,
            amount: Number(price), // Safety Cast
            paymentMethod,
            operator: operator || 'Sistema',
            invoiceType: invoiceType || 'Final',
            plate: stay.plate,
            notes: notes,
            createdAt: new Date(),
        };

        return {
            closedStay: StaySchema.parse(closedStay),
            exitMovement: MovementSchema.parse(exitMovement),
            price
        };
    }
}
