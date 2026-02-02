import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SubscriptionRepository } from './SubscriptionRepository';
import { Subscription } from '../../../shared/schemas';
import { v4 as uuidv4 } from 'uuid';
import { connectTestDB, disconnectTestDB } from '../../../infrastructure/database/test-setup';

describe('SubscriptionRepository Integration', () => {
    const repository = new SubscriptionRepository();

    beforeAll(async () => {
        await connectTestDB();
    }, 60000);

    afterAll(async () => {
        await disconnectTestDB();
    });

    it('debe guardar y recuperar suscripción activa por vehiculo', async () => {
        const sub: Subscription = {
            id: uuidv4(),
            customerId: uuidv4(),
            vehicleId: 'car-active-1',
            type: 'Fija',
            startDate: new Date(),
            price: 100,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await repository.save(sub);

        const found = await repository.findActiveByVehicleId('car-active-1');
        expect(found).toBeDefined();
        expect(found?.price).toBe(100);
    });

    it('debe filtrar suscripciones inactivas', async () => {
        const sub: Subscription = {
            id: uuidv4(),
            customerId: uuidv4(),
            vehicleId: 'car-inactive-1',
            type: 'Fija',
            startDate: new Date(),
            price: 100,
            active: false, // Inactiva
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await repository.save(sub);

        const found = await repository.findActiveByVehicleId('car-inactive-1');
        expect(found).toBeNull();
    });
});
