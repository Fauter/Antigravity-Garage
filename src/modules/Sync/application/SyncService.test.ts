import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SyncService } from './SyncService';
import { connectTestDB, disconnectTestDB } from '../../../infrastructure/database/test-setup';
import { Mutation } from '../../../shared/schemas';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { v4 as uuidv4 } from 'uuid';

describe('SyncService Integration', () => {
    let service: SyncService;
    let repo: VehicleRepository;

    beforeAll(async () => {
        await connectTestDB();
        service = new SyncService();
        repo = new VehicleRepository();
    });

    afterAll(async () => {
        await disconnectTestDB();
    });

    it('debe procesar un lote de mutaciones secuencialmente', async () => {
        const mutations: Mutation[] = [
            {
                id: uuidv4(),
                entityType: 'Vehicle',
                entityId: 'V-SYNC-1',
                operation: 'CREATE',
                payload: {
                    id: 'V-SYNC-1',
                    plate: 'SYNC-001',
                    type: 'Auto',
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                timestamp: new Date(),
                synced: false,
                retryCount: 0
            },
            {
                id: uuidv4(),
                entityType: 'Vehicle',
                entityId: 'V-SYNC-2',
                operation: 'CREATE',
                payload: {
                    id: 'V-SYNC-2',
                    plate: 'SYNC-002',
                    type: 'Moto', // Moto
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                timestamp: new Date(),
                synced: false,
                retryCount: 0
            }
        ];

        const result = await service.processMutations(mutations);
        expect(result.processed).toBe(2);
        expect(result.conflicts).toBe(0);

        // Verificar persistencia
        const v1 = await repo.findById('V-SYNC-1');
        expect(v1?.plate).toBe('SYNC-001');
    });

    it('debe respetar Last-Write-Wins (ignorar mutación vieja)', async () => {
        const vehicleId = 'V-LWW-1';

        // 1. Crear versión local "Nueva"
        await repo.save({
            id: vehicleId,
            plate: 'NEW-PLATE',
            type: 'Auto',
            createdAt: new Date(),
            updatedAt: new Date('2025-01-01T12:00:00Z') // Hora 12:00
        });

        // 2. Llegar Mutación "Vieja" (Hora 10:00)
        const oldMutation: Mutation = {
            id: uuidv4(),
            entityType: 'Vehicle',
            entityId: vehicleId,
            operation: 'UPDATE',
            payload: {
                id: vehicleId,
                plate: 'OLD-PLATE',
                type: 'Auto',
                createdAt: new Date(),
                updatedAt: new Date('2025-01-01T10:00:00Z')
            },
            timestamp: new Date('2025-01-01T10:00:00Z'),
            synced: false,
            retryCount: 0
        };

        const result = await service.processMutations([oldMutation]);

        // Debería procesarse "exitosamente" (sin error) pero NO aplicar cambios
        // Ojo: Mi implementación actual cuenta como processed aunque ignore.
        expect(result.processed).toBe(1);

        // Verificar que la placa sigue siendo la NUEVA
        const stored = await repo.findById(vehicleId);
        expect(stored?.plate).toBe('NEW-PLATE');
    });
});
