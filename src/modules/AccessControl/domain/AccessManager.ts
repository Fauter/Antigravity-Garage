import { v4 as uuidv4 } from 'uuid';
import {
    Movement,
    Vehicle,
    Customer,
    MovementSchema,
    Stay,
    StaySchema
} from '../../../shared/schemas';
import { PricingEngine, TarifasConfig } from '../../Billing/domain/PricingEngine';

export interface AccessConfig {
    tarifas: TarifasConfig;
    hourlyRate: number;
}

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
    static processExit(
        stay: Stay,
        exitDate: Date,
        config: AccessConfig,
        paymentMethod: 'Efectivo' | 'MercadoPago' | 'Tarjeta' | 'Otro' = 'Efectivo',
        operator?: string
    ): { closedStay: Stay; exitMovement: Movement; price: number } {
        if (!stay.active) {
            throw new Error('La estancia ya está cerrada.');
        }

        // 1. Calcular estadía
        const price = PricingEngine.calculateParkingFee(
            stay.entryTime,
            exitDate,
            config.hourlyRate
        );

        const exitMovement: Movement = {
            id: uuidv4(),
            relatedEntityId: stay.id,
            type: 'CobroEstadia',
            timestamp: exitDate,
            amount: price,
            paymentMethod,
            operator,

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
