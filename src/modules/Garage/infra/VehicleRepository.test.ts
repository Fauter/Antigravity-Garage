import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VehicleRepository } from './VehicleRepository';
import { Vehicle } from '../../../shared/schemas';
import { v4 as uuidv4 } from 'uuid';
import { connectTestDB, disconnectTestDB } from '../../../infrastructure/database/test-setup';

describe('VehicleRepository Integration (Memory)', () => {
    const repository = new VehicleRepository();

    beforeAll(async () => {
        await connectTestDB();
    }, 60000);

    afterAll(async () => {
        await disconnectTestDB();
    });

    it('debe guardar y recuperar un vehículo correctamente', async () => {
        const vehicle: Vehicle = {
            id: uuidv4(),
            plate: 'TEST-MEM',
            type: 'Auto',
            description: 'Memory DB Test',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const saved = await repository.save(vehicle);
        expect(saved.id).toBe(vehicle.id);
        expect(saved.plate).toBe('TEST-MEM');

        const found = await repository.findById(vehicle.id);
        expect(found).toBeDefined();
        expect(found?.plate).toBe('TEST-MEM');

        const foundByPlate = await repository.findByPlate('TEST-MEM');
        expect(foundByPlate).toBeDefined();
    });
});
