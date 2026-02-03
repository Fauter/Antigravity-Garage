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
import { JsonTariffRepository } from '../../Configuration/infrastructure/JsonTariffRepository';
import { JsonParamRepository } from '../../Configuration/infrastructure/JsonParamRepository';
import { JsonPriceMatrixRepository } from '../../Configuration/infrastructure/JsonPriceMatrixRepository';

// Backend Instance of Pricing Engine
const tariffRepo = new JsonTariffRepository();
const paramRepo = new JsonParamRepository();
const priceRepo = new JsonPriceMatrixRepository();
const pricingEngine = new PricingEngine(tariffRepo, paramRepo, priceRepo);

export class AccessManager {
    /**
     * Registra la entrada de un vehículo.
     * Crea un registro de Estancia (Stay).
     */
    static processEntry(
        plate: string,
        vehicle?: Vehicle | null,
        customer?: Customer | null
    ): Stay {
        const entryStay: Stay = {
            id: uuidv4(),
            plate: plate.toUpperCase(),
            vehicleId: vehicle ? vehicle.id : null,
            entryTime: new Date(),
            active: true,

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

        // 1. Calcular estadía (Dynamically using Repositories hidden in PricingEngine)
        const price = await pricingEngine.calculateParkingFee(
            stay,
            exitDate,
            paymentMethod
        );

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

            notes: `Salida de: ${stay.plate}`,

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
