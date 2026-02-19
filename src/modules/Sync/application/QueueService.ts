import { db } from '../../../infrastructure/database/datastore.js';
import { v4 as uuidv4 } from 'uuid';

export interface MutationPayload {
    id: string;
    entityType: string;
    entityId: string;
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: any;
    timestamp: Date;
    synced: boolean;
    retryCount: number;
}

export class QueueService {

    /**
     * Enqueues a mutation for background sync.
     */
    async enqueue(entityType: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any) {
        // Ensure payload has ID
        if (!payload.id) {
            console.error('❌ Queue: Payload missing ID', payload);
            return;
        }

        const mutation: MutationPayload = {
            id: uuidv4(),
            entityType,
            entityId: payload.id,
            operation,
            payload,
            timestamp: new Date(),
            synced: false,
            retryCount: 0
        };

        try {
            await db.mutations.insert(mutation);
            console.log(`📥 Queue: Mutation Enqueued [${operation} ${entityType}]`);
        } catch (error) {
            console.error('❌ Queue: Failed to enqueue', error);
        }
    }

    /**
     * Get pending mutations ordered by timestamp
     */
    async getPending(limit = 50): Promise<MutationPayload[]> {
        return await db.mutations.find({ synced: false }).sort({ timestamp: 1 }).limit(limit) as unknown as MutationPayload[];
    }

    /**
     * Mark mutation as synced
     */
    async markSynced(id: string) {
        await db.mutations.update({ id }, { $set: { synced: true } });
    }

    /**
     * Increment retry count
     */
    async incrementRetry(id: string) {
        await db.mutations.update({ id }, { $inc: { retryCount: 1 } });
    }
}
