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
import { ConfigRepository } from '../../Configuration/infra/ConfigRepository';

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
        invoiceType?: 'A' | 'B' | 'C' | 'CC' | 'Final'
    ): Promise<{ closedStay: Stay; exitMovement: Movement; price: number }> {
        if (!stay.active) {
            throw new Error('La estancia ya está cerrada.');
        }

        // Dynamically instantiate PricingEngine for this Garage
        const garageId = (stay as any).garageId;
        if (!garageId) console.warn('⚠️ AccessManager: Stay missing garageId, pricing might fail.');

        const configRepo = new ConfigRepository();

        // Adapters
        const tariffRepo = { getAll: () => configRepo.getTariffs(garageId) };
        const paramRepo = { getParams: () => configRepo.getParams() };
        const priceRepo = { getPrices: (m: string) => configRepo.getPrices(garageId, m) };

        const engine = new PricingEngine(tariffRepo, paramRepo, priceRepo);

        // 1. Calculate Price
        let price = 0;
        let notes = '';

        if (stay.isSubscriber) {
            price = 0;
            notes = `Salida Abonado - (ID: ${stay.subscriptionId?.slice(0, 8) || 'N/A'})`;
            console.log(`💎 Exit: Subscriber Departure for ${stay.plate}. Price set to $0.`);
        } else {
            price = await engine.calculateParkingFee(
                stay,
                exitDate,
                paymentMethod
            );
        }

        // Calculate Duration for Notes (Append if subscriber)
        const durationMs = exitDate.getTime() - new Date(stay.entryTime).getTime();
        const durationMin = Math.ceil(durationMs / 60000);
        const hours = Math.floor(durationMin / 60);
        const mins = durationMin % 60;
        const timeString = `${hours}:${mins.toString().padStart(2, '0')}hs`;

        if (!stay.isSubscriber) {
            notes = `Por ${timeString}`;
        } else {
            notes += ` - Tiempo: ${timeString}`;
        }

        const exitMovement: Movement = {
            id: uuidv4(),
            relatedEntityId: stay.id,
            type: 'CobroEstadia',
            timestamp: exitDate,
            amount: price,
            paymentMethod,
            operator,
            invoiceType: invoiceType || 'Final',
            plate: stay.plate,

            notes: notes,

            createdAt: new Date(),
        };

        const closedStay: Stay = {
            ...stay,
            active: false,
            exitTime: exitDate
        };

        return {
            closedStay: StaySchema.parse(closedStay),
            exitMovement: MovementSchema.parse(exitMovement),
            price
        };
    }
}
