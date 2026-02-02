import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface Mutation {
    id: string;
    entityType: string;
    entityId: string;
    operation: 'create' | 'update' | 'delete';
    payload: any;
    timestamp: number;
    synced: boolean;
}

const QUEUE_KEY = 'garage_mutation_queue';

class MutationQueueService {
    private queue: Mutation[] = [];
    private isSyncing = false;

    constructor() {
        this.loadQueue();
        window.addEventListener('online', this.sync);
    }

    private loadQueue() {
        const stored = localStorage.getItem(QUEUE_KEY);
        if (stored) {
            this.queue = JSON.parse(stored);
        }
    }

    private saveQueue() {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    }

    async addMutation(entityType: string, entityId: string, operation: 'create' | 'update' | 'delete', payload: any) {
        const mutation: Mutation = {
            id: uuidv4(),
            entityType,
            entityId,
            operation,
            payload,
            timestamp: Date.now(),
            synced: false
        };

        this.queue.push(mutation);
        this.saveQueue();

        // Try to sync immediately if online
        if (navigator.onLine) {
            this.sync();
        }
    }

    sync = async () => {
        if (this.isSyncing || this.queue.length === 0 || !navigator.onLine) return;

        this.isSyncing = true;
        const pendingMutations = this.queue.filter(m => !m.synced);

        if (pendingMutations.length === 0) {
            this.isSyncing = false;
            return;
        }

        try {
            console.log(`📡 Syncing ${pendingMutations.length} mutations...`);
            const response = await axios.post('http://localhost:3000/api/sync', pendingMutations);

            if (response.status === 200) {
                // If successful, remove synced mutations from queue
                // In a robust system, we might want to keep them or mark as synced until confirmed
                // For now, we clear them to keep queue small
                const syncedIds = pendingMutations.map(m => m.id); // Assuming simple ACK
                this.queue = this.queue.filter(m => !syncedIds.includes(m.id));
                this.saveQueue();
                console.log('✅ Sync successful');
            }
        } catch (error) {
            console.error('❌ Sync failed:', error);
            // Keep in queue for retry
        } finally {
            this.isSyncing = false;
        }
    }

    getQueue() {
        return this.queue;
    }
}

export const MutationQueue = new MutationQueueService();
