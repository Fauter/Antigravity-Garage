import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MutationQueue } from './MutationQueue';
import { MutationModel } from '../../../infrastructure/database/models';
import { connectTestDB, disconnectTestDB } from '../../../infrastructure/database/test-setup';

describe('MutationQueue Integration', () => {
    beforeAll(async () => {
        await connectTestDB();
    }, 60000);

    afterAll(async () => {
        await disconnectTestDB();
    });

    it('debe registrar una mutación en la cola', async () => {
        const payload = { foo: 'bar' };

        const mutation = await MutationQueue.addToQueue(
            'Vehicle',
            'test-id-123',
            'CREATE',
            payload
        );

        expect(mutation.id).toBeDefined();
        expect(mutation.entityType).toBe('Vehicle');
        expect(mutation.operation).toBe('CREATE');
        expect(mutation.synced).toBe(false);

        // Verify persistence
        const stored = await MutationModel.findOne({ id: mutation.id });
        expect(stored).toBeDefined();
        expect(stored?.payload).toEqual(payload);
    });
});
