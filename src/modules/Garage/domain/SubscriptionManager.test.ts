import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { SubscriptionManager } from './SubscriptionManager';
import { Subscription, Vehicle } from '../../../shared/schemas';
import { TarifasConfig } from '../../Billing/domain/PricingEngine';

describe('SubscriptionManager', () => {
    // New config structure with Payment Methods
    const mockConfig: TarifasConfig = {
        mensual: {
            Exclusiva: { Efectivo: 100 },
            Fija: { Efectivo: 80 },
            Movil: { Efectivo: 50 },
        },
        mora: { nivel1: 10, nivel2: 20 }
    } as any; // Cast laxo para no definir todos los métodos en el test

    const validUuid1 = uuidv4();
    const validUuid2 = uuidv4();
    const validUuid3 = uuidv4();

    const mockVehicle: Vehicle = {
        id: validUuid2,
        plate: 'ABC-123',
        type: 'Auto',
        createdAt: new Date(),
        updatedAt: new Date()
    };

    it('debe crear suscripción Fija si no hay colisión', () => {
        const activeSubs: Subscription[] = [];
        const startDate = new Date(2024, 0, 1);
        const paymentDate = new Date(2024, 0, 5);

        const sub = SubscriptionManager.createSubscription(
            validUuid1,
            'Fija',
            startDate,
            activeSubs,
            mockConfig,
            mockVehicle,
            paymentDate
        );

        expect(sub.type).toBe('Fija');
        expect(sub.price).toBe(80);
    });

    it('debe bloquear suscripción Fija si vehículo ya tiene una activa', () => {
        const activeSub: Subscription = {
            id: validUuid3,
            customerId: validUuid1,
            vehicleId: validUuid2,
            type: 'Fija',
            startDate: new Date(),
            price: 80,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        expect(() => {
            SubscriptionManager.createSubscription(
                validUuid1,
                'Fija',
                new Date(),
                [activeSub],
                mockConfig,
                mockVehicle
            );
        }).toThrowError(/cochera Fija activa/);
    });

    it('debe calcular renovación correctamente', () => {
        const sub: Subscription = {
            id: validUuid3,
            customerId: validUuid1,
            vehicleId: null,
            type: 'Movil',
            startDate: new Date(),
            price: 0,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const renewalDate = new Date(2024, 1, 1);

        const renewedSub = SubscriptionManager.renewSubscription(
            sub,
            renewalDate,
            mockConfig,
            renewalDate
        );

        expect(renewedSub.price).toBe(50);
    });

    describe('TemporalHelper / ADVANCE Flow', () => {
        it('debe predecir matemáticamente el último día del mes siguiente', () => {
            // Enero 31 -> Febrero 28 (año no bisiesto 2023)
            const d1 = new Date(2023, 0, 31, 23, 59, 59);
            const next1 = SubscriptionManager.getNextCoverageEnd(d1);
            expect(next1.getFullYear()).toBe(2023);
            expect(next1.getMonth()).toBe(1); // Febrero (0-indexed)
            expect(next1.getDate()).toBe(28);

            // Enero 31 -> Febrero 29 (año bisiesto 2024)
            const d2 = new Date(2024, 0, 31, 23, 59, 59);
            const next2 = SubscriptionManager.getNextCoverageEnd(d2);
            expect(next2.getFullYear()).toBe(2024);
            expect(next2.getMonth()).toBe(1);
            expect(next2.getDate()).toBe(29);

            // Diciembre 31 -> Enero 31 del año siguiente
            const d3 = new Date(2023, 11, 31, 23, 59, 59);
            const next3 = SubscriptionManager.getNextCoverageEnd(d3);
            expect(next3.getFullYear()).toBe(2024);
            expect(next3.getMonth()).toBe(0); // Enero
            expect(next3.getDate()).toBe(31);

            // Día que no es fin de mes -> El comportamiento es forzarlo a fin del mes siguiente
            const d4 = new Date(2024, 3, 15, 23, 59, 59); // Abril 15
            const next4 = SubscriptionManager.getNextCoverageEnd(d4);
            expect(next4.getFullYear()).toBe(2024);
            expect(next4.getMonth()).toBe(4); // Mayo
            expect(next4.getDate()).toBe(31); // Mayo 31
            expect(next4.getHours()).toBe(23);
            expect(next4.getMinutes()).toBe(59);
            expect(next4.getSeconds()).toBe(59);
        });

        it('debe aplicar la renovación adelantada en el objeto Subscription', () => {
            const currentEndDate = new Date(2024, 6, 31, 23, 59, 59); // Julio 31 2024
            const sub: Subscription = {
                id: validUuid3,
                customerId: validUuid1,
                vehicleId: null,
                type: 'Fija',
                startDate: new Date(2024, 0, 1),
                endDate: currentEndDate,
                price: 80,
                active: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const expectedPrice = 80; // según mockConfig 'Fija' Efectivo

            const advancedSub = SubscriptionManager.advanceSubscription(
                sub,
                mockConfig,
                new Date(),
                'Efectivo'
            );

            expect(advancedSub.price).toBe(expectedPrice);
            // El endDate debe ser el último día de Agosto 2024
            expect(advancedSub.endDate!.getFullYear()).toBe(2024);
            expect(advancedSub.endDate!.getMonth()).toBe(7); // Agosto (0-indexed)
            expect(advancedSub.endDate!.getDate()).toBe(31); // Agosto tiene 31 días
            expect(advancedSub.endDate!.getHours()).toBe(23);
            expect(advancedSub.endDate!.getMinutes()).toBe(59);
            expect(advancedSub.endDate!.getSeconds()).toBe(59);
        });
    });
});
