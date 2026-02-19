import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';

export interface Subscription {
    id?: string;
    _id?: string;
    customerId?: string;
    vehicleId?: string;
    plate?: string;
    status: 'active' | 'inactive' | 'pending';
    type?: string;
    startDate: Date;
    endDate?: Date;
    active?: boolean; // Schema compatibility
    price?: number;
}

export class SubscriptionRepository {
    private queue = new QueueService();

    constructor() { }

    async save(subscription: any): Promise<any> {
        if (!subscription.id) {
            subscription.id = uuidv4();
        }

        try {
            await db.subscriptions.update({ id: subscription.id }, subscription, { upsert: true });
        } catch (err) {
            console.error('❌ Repo: Sub Save Failed', err);
            throw err;
        }

        await this.queue.enqueue('Subscription', 'UPDATE', subscription);
        return subscription;
    }

    async findAll(): Promise<any[]> {
        return await db.subscriptions.find({});
    }

    async findByCustomerId(customerId: string): Promise<any[]> {
        return await db.subscriptions.find({ customerId });
    }

    async findActiveByPlate(plate: string): Promise<any | null> {
        // NeDB doesn't strictly support computed fields in find easily without operator,
        // but 'active' or 'status' should be stored.
        // Assuming 'active' boolean is used by Schema, or 'status' by interface.
        return await db.subscriptions.findOne({ plate, active: true });
    }

    async reset(): Promise<void> {
        await db.subscriptions.remove({}, { multi: true });
    }
}
