import { SubscriptionType } from '../../../shared/schemas';

export interface PricingByMethod {
    Efectivo: number;
    [key: string]: number; // Otros métodos
}

export interface TarifasConfig {
    mensual: {
        Exclusiva: PricingByMethod;
        Fija: PricingByMethod;
        Movil: PricingByMethod;
    };
    mora: {
        nivel1: number;
        nivel2: number;
    };
}

/**
 * Motor de precios puro (Domain Service).
 * Soporta precios diferenciados por método de pago.
 */
export class PricingEngine {
    /**
     * Calcula el monto a cobrar por una suscripción.
     * 
     * @param type Tipo de suscripción
     * @param startDate Fecha de inicio
     * @param endDate Fecha de fin
     * @param config Configuración de precios (con diferenciación por método)
     * @param paymentDate Fecha efectiva del pago
     * @param paymentMethod Método de pago (Efectivo por defecto)
     */
    static calculateSubscriptionFee(
        type: SubscriptionType,
        startDate: Date,
        endDate: Date,
        config: TarifasConfig,
        paymentDate: Date = new Date(),
        paymentMethod: string = 'Efectivo'
    ): number {
        // 1. Obtener configuración de precio para el tipo
        const priceConfig = config.mensual[type];
        if (!priceConfig) {
            throw new Error(`Tarifa no configurada para el tipo de suscripción: ${type}`);
        }

        // 2. Seleccionar precio base según método de pago
        // Si el método no existe explícitamente, usamos 'Efectivo' como base.
        let basePrice = priceConfig[paymentMethod];
        if (basePrice === undefined) {
            basePrice = priceConfig['Efectivo'];
        }

        // 3. Determinar si es un Alta Nueva (Prorrateo)
        // Ensure startDate is Date object
        const startObj = new Date(startDate);
        const startDay = startObj.getDate();
        const isProrated = startDay > 1;

        if (isProrated) {
            // Cálculo de Prorrateo: (base / diasMes) * diasRestantes
            const year = startObj.getFullYear();
            const month = startObj.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const diasRestantes = daysInMonth - startDay + 1;

            const dailyRate = basePrice / daysInMonth;
            const proratedAmount = dailyRate * diasRestantes;

            return Math.round(proratedAmount * 100) / 100;
        }

        // 4. Si NO es prorrateo, verificamos Mora
        const paymentDay = paymentDate.getDate();
        let surcharge = 0;

        // Reglas de Mora (Niveles)
        if (paymentDay >= 22) {
            surcharge = config.mora.nivel2;
        } else if (paymentDay >= 11) {
            surcharge = config.mora.nivel1;
        }

        return basePrice + surcharge;
    }

    /**
     * Calcula el cobro por estadía (Rotativo) con diferenciación por método.
     */
    static calculateParkingFee(
        entryDate: Date,
        exitDate: Date,
        hourlyRate: number,
        paymentMethod: string = 'Efectivo'
    ): number {
        // Ensure we have valid Date objects
        const start = new Date(entryDate);
        const end = new Date(exitDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            console.error('Invalid dates provided to calculateParkingFee', { entryDate, exitDate });
            return 0; // Safe fallback
        }

        const durationMs = end.getTime() - start.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);

        // Ceiling to next hour
        const hoursToCharge = Math.ceil(durationHours);
        if (hoursToCharge <= 0) return 0; // Avoid negative prices or zero

        let total = hoursToCharge * hourlyRate;

        // Apply surcharge for non-cash methods (Example logic from requirements - can be configured)
        if (paymentMethod !== 'Efectivo') {
            // Assuming 10% surcharge as seen in frontend logic previously
            // Ideally this percentage comes from config, but hardcoding for now as per "Shared Logic" goal
            total = Math.ceil(total * 1.1);
        }

        return total;
    }
}
