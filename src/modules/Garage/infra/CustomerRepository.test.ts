import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CustomerRepository } from './CustomerRepository';
import { Customer } from '../../../shared/schemas';
import { v4 as uuidv4 } from 'uuid';
import { connectTestDB, disconnectTestDB } from '../../../infrastructure/database/test-setup';

describe('CustomerRepository Integration', () => {
    const repository = new CustomerRepository();

    beforeAll(async () => {
        await connectTestDB();
    }, 60000);

    afterAll(async () => {
        await disconnectTestDB();
    });

    it('debe guardar y buscar cliente', async () => {
        const customer: Customer = {
            id: uuidv4(),
            name: 'Jules AI',
            email: 'jules@antigravity.dev',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await repository.save(customer);
        const found = await repository.findById(customer.id);

        expect(found).toBeDefined();
        expect(found?.name).toBe('Jules AI');
    });
});
