import { db } from '../../../infrastructure/database/datastore.js';
import { v4 as uuidv4 } from 'uuid';

export type SyncStatus = 'PENDING' | 'RETRY' | 'ACKED' | 'BLOCKED';

export interface MutationPayload {
    id: string;
    entityType: string;
    entityId: string;
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: any;
    timestamp: Date;
    synced: boolean; // Legacy
    retryCount: number;
    status?: SyncStatus;
    lastError?: string;
    lastErrorCode?: string;
    nextAttemptAt?: Date;
    ackedAt?: Date;
}

export class QueueService {

    /**
     * Enqueues a mutation for background sync.
     * Throws LOCAL_SAVED_SYNC_INTENT_FAILED if it completely fails to enqueue.
     */
    async enqueue(entityType: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any) {
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
            retryCount: 0,
            status: 'PENDING'
        };

        let retries = 3;
        let success = false;
        
        while (retries > 0 && !success) {
            try {
                await db.mutations.insert(mutation);
                console.log(`📥 Queue: Mutation Enqueued [${operation} ${entityType}]`);
                success = true;
            } catch (error) {
                retries--;
                console.error(`❌ Queue: Failed to enqueue, retries left: ${retries}`, error);
                if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // short backoff
                } else {
                    const enhancedError = new Error(`LOCAL_SAVED_SYNC_INTENT_FAILED: Failed to enqueue ${entityType} mutation after retries.`);
                    enhancedError.name = 'QueuePersistenceError';
                    enhancedError.cause = error;
                    throw enhancedError;
                }
            }
        }
    }

    /**
     * Get pending mutations ordered by timestamp
     */
    async getPending(limit = 50): Promise<MutationPayload[]> {
        const now = new Date();
        // Legacy: status doesn't exist, synced is false.
        // New: status is PENDING or (status is RETRY and nextAttemptAt <= now)
        return await db.mutations.find({
            $or: [
                { status: 'PENDING' },
                { status: 'RETRY', nextAttemptAt: { $lte: now } },
                { status: { $exists: false }, synced: false } // Legacy compatibility
            ]
        }).sort({ timestamp: 1 }).limit(limit) as unknown as MutationPayload[];
    }

    /**
     * Mark mutation as ACKED (Legacy: synced = true)
     */
    async markSynced(id: string) {
        // [PHASE 0 SECURITY NOTE: ACK Lost]
        // If a mutation succeeds in Supabase (upsert applied), but the response is lost due to connection drop 
        // before reaching here, the mutation will remain PENDING and be retried later.
        // Because Supabase 'upsert' by UUID is idempotent, retrying the row-state is safe for the database row.
        // HOWEVER, if the backend runs edge functions, webhooks, or side-effects based on row inserts/updates, 
        // those side-effects MAY BE TRIGGERED TWICE. 
        // This is an acknowledged limitation of the current Phase 0 architecture. True exactly-once semantics 
        // requires a Transactional Outbox combined with idempotency keys on the Supabase side (Phase 1).
        await db.mutations.update({ id }, { $set: { synced: true, status: 'ACKED', ackedAt: new Date() } });
    }

    /**
     * Mark mutation as BLOCKED (Poison pill)
     */
    async markBlocked(id: string, errorMsg: string, errorCode?: string) {
        await db.mutations.update({ id }, { $set: { status: 'BLOCKED', lastError: errorMsg, lastErrorCode: errorCode } });
    }

    /**
     * Mark mutation for RETRY with exponential backoff + jitter
     */
    async markRetry(id: string, errorMsg: string, currentRetryCount: number) {
        const MAX_BACKOFF = 60000; // 1 minute max backoff for Phase 0
        const baseDelay = Math.min(1000 * Math.pow(2, currentRetryCount), MAX_BACKOFF);
        const jitter = Math.random() * 1000;
        const nextAttemptAt = new Date(Date.now() + baseDelay + jitter);
        
        await db.mutations.update({ id }, { 
            $set: { 
                status: 'RETRY', 
                lastError: errorMsg,
                nextAttemptAt 
            },
            $inc: { retryCount: 1 }
        });
    }

    /**
     * Increment retry count (Legacy, optionally keep for backwards comp if needed, but replaced by markRetry)
     */
    async incrementRetry(id: string) {
        await db.mutations.update({ id }, { $inc: { retryCount: 1 } });
    }
}
