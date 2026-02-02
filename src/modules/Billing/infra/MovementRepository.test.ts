import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MovementRepository } from './MovementRepository';
import { Movement } from '../../../shared/schemas';
import { v4 as uuidv4 } from 'uuid';
import { connectTestDB, disconnectTestDB } from '../../../infrastructure/database/test-setup';

describe('MovementRepository Integration', () => {
    const repository = new MovementRepository();

    beforeAll(async () => {
        await connectTestDB();
    }, 60000);

    afterAll(async () => {
        await disconnectTestDB();
    });

    it('debe guardar y recuperar un movimiento financiero', async () => {
        const movement: Movement = {
            id: uuidv4(),
            type: 'CobroEstadia',
            amount: 500,
            paymentMethod: 'Efectivo',
            plate: 'ABC-999',
            timestamp: new Date(),
            createdAt: new Date()
        };

        await repository.save(movement);

        const found = await repository.findById(movement.id);
        expect(found).toBeDefined();
        expect(found?.amount).toBe(500);
        expect(found?.type).toBe('CobroEstadia');
    });

    it('debe buscar movimientos por turno', async () => {
        const shiftId = uuidv4();
        const m1: Movement = {
            id: uuidv4(),
            type: 'CobroEstadia',
            amount: 100,
            paymentMethod: 'Efectivo',
            plate: 'AAA-111',
            shiftId,
            timestamp: new Date(),
            createdAt: new Date()
        };
        const m2: Movement = {
            id: uuidv4(),
            type: 'CobroEstadia',
            amount: 200,
            paymentMethod: 'Tarjeta',
            plate: 'BBB-222',
            shiftId,
            timestamp: new Date(),
            createdAt: new Date()
        };

        await repository.save(m1);
        await repository.save(m2);

        const results = await repository.findByShiftId(shiftId);
        expect(results).toHaveLength(2);

        const sum = results.reduce((acc, curr) => acc + curr.amount, 0);
        expect(sum).toBe(300);
    });
});
