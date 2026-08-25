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
        const sub = { id: 'sub-3', plate: 'car-active', customerId: 'cust-1', active: true, price: 100 };
        await repository.save(sub);

        const found = await repository.findActiveByPlate('car-active');
        expect(found).toBeDefined();
        expect(found?.price).toBe(100);
    });

    it('debe retornar null si no hay suscripción activa', async () => {
        const found = await repository.findActiveByPlate('car-nonexistent');
        expect(found).toBeNull();
    });

    it('debe filtrar suscripciones inactivas', async () => {
        const sub = { id: 'sub-4', plate: 'car-inactive', customerId: 'cust-1', active: false, price: 100 };
        await repository.save(sub);

        const found = await repository.findActiveByPlate('car-inactive');
        expect(found).toBeNull();
    });
});
