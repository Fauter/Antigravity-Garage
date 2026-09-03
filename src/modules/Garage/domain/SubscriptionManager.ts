import { v4 as uuidv4 } from 'uuid';
import {
    Subscription,
    SubscriptionSchema,
    Vehicle,
    SubscriptionType
} from '../../../shared/schemas';
import { PricingEngine, type TarifasConfig } from '../../Billing/domain/PricingEngine';

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
        const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999); // Fin de mes local al ultimo segundo

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
            endDate, // Ahora persiste la fecha real de fin de mes
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
        // Último segundo del último día del mes actual
        const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

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
            endDate: endOfMonth,
            price,
            updatedAt: new Date()
        };
    }
    /**
     * Helper temporal para calcular de forma segura el último milisegundo del MES SIGUIENTE
     * al mes del endDate actual, manejando años bisiestos y longitudes de meses dispares.
     */
    static getNextCoverageEnd(currentEndDate: Date): Date {
        const d = new Date(currentEndDate.getTime());
        const year = d.getFullYear();
        const month = d.getMonth();
        // El día 0 del mes "month + 2" es el último día del mes "month + 1"
        return new Date(year, month + 2, 0, 23, 59, 59, 999);
    }

    /**
     * RAMA EXPLÍCITA PARA RENOVACIÓN ANTICIPADA
     * Extiende la cobertura exactamente 1 mes hacia el futuro partiendo del endDate actual.
     */
    static advanceSubscription(
        subscription: Subscription,
        config: TarifasConfig,
        paymentDate: Date = new Date(),
        paymentMethod: string = 'Efectivo',
        resolvedPrice?: number
    ): Subscription {
        if (!subscription.active) {
            throw new Error('No se puede anticipar una suscripción inactiva.');
        }
        if (!subscription.endDate) {
            throw new Error('No se puede anticipar una suscripción sin endDate válido.');
        }

        const newEndDate = this.getNextCoverageEnd(new Date(subscription.endDate));
        
        const nextPeriodStart = new Date(subscription.endDate);
        nextPeriodStart.setDate(nextPeriodStart.getDate() + 1); // El día 1 del próximo mes

        const price = (resolvedPrice && resolvedPrice > 0)
            ? resolvedPrice
            : PricingEngine.calculateSubscriptionFee(
                subscription.type,
                nextPeriodStart, // inicio del proximo periodo
                newEndDate,
                config,
                paymentDate,
                paymentMethod
            );

        return {
            ...subscription,
            // startDate podría avanzar también o quedarse, mantenemos la convención
            // de que si es un nuevo periodo completo, startDate avanza al inicio del nuevo periodo.
            // Esto evita que startDate quede meses atrás y confunda a UI.
            startDate: new Date(new Date(subscription.endDate).getTime() + 1), 
            endDate: newEndDate,
            price,
            updatedAt: new Date()
        };
    }
}
