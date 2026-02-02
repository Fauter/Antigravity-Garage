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
});
