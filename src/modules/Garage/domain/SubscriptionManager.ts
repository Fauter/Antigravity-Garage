import { v4 as uuidv4 } from 'uuid';
import {
    Subscription,
    SubscriptionSchema,
    Vehicle,
    SubscriptionType
} from '../../../shared/schemas';
import { PricingEngine, TarifasConfig } from '../../Billing/domain/PricingEngine';

export class SubscriptionManager {
    /**
     * Crea una nueva suscripción.
     * Valida colisiones de cocheras fijas.
     */
    static createSubscription(
        customerId: string,
        type: SubscriptionType,
        startDate: Date,
        activeSubscriptions: Subscription[],
        config: TarifasConfig,
        vehicle?: Vehicle | null,
        paymentDate: Date = new Date(),
        paymentMethod: string = 'Efectivo'
    ): Subscription {
        // 1. Validaciones de Negocio Específicas
        if (type === 'Fija') {
            if (!vehicle) {
                throw new Error('Suscripción Fija requiere asignar un vehículo.');
            }

            const isVehicleTaken = activeSubscriptions.some(sub =>
                sub.active &&
                sub.type === 'Fija' &&
                sub.vehicleId === vehicle.id
            );

            if (isVehicleTaken) {
                throw new Error('El vehículo ya posee una cochera Fija activa.');
            }
        }

        // 2. Calcular Precio Inicial (Prorrateo si aplica)
        const year = startDate.getFullYear();
        const month = startDate.getMonth();
        const endDate = new Date(year, month + 1, 0); // Fin de mes local

        const price = PricingEngine.calculateSubscriptionFee(
            type,
            startDate,
            endDate,
            config,
            paymentDate,
            paymentMethod
        );

        const subscription: Subscription = {
            id: uuidv4(),
            customerId,
            vehicleId: vehicle ? vehicle.id : null,
            type,
            startDate,
            endDate: null, // Indefinida/Renorable
            price,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        return SubscriptionSchema.parse(subscription);
    }

    static renewSubscription(
        subscription: Subscription,
        renewalDate: Date,
        config: TarifasConfig,
        paymentDate: Date = new Date(),
        paymentMethod: string = 'Efectivo'
    ): Subscription {
        if (!subscription.active) {
            throw new Error('No se puede renovar una suscripción inactiva.');
        }

        // Calculamos precio mes completo
        const year = renewalDate.getFullYear();
        const month = renewalDate.getMonth();
        const endOfMonth = new Date(year, month + 1, 0);

        const price = PricingEngine.calculateSubscriptionFee(
            subscription.type,
            renewalDate,
            endOfMonth,
            config,
            paymentDate,
            paymentMethod
        );

        return {
            ...subscription,
            startDate: renewalDate,
            price,
            updatedAt: new Date()
        };
    }
}
