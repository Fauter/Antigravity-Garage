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

    async findById(id: string): Promise<any | null> {
        return await db.subscriptions.findOne({ id });
    }

    async findActiveByPlate(plate: string): Promise<any | null> {
        // Create a regex to match the plate ignoring spaces, dashes, and casing
        const plateRegex = new RegExp([...plate].join('[\\\\s\\\\-_]*'), 'i');
        return await db.subscriptions.findOne({ plate: { $regex: plateRegex }, active: true });
    }

    async reset(): Promise<void> {
        await db.subscriptions.remove({}, { multi: true });
    }

    async delete(id: string): Promise<void> {
        try {
            await db.subscriptions.remove({ id }, { multi: false });
            // Queue delete operation
            await this.queue.enqueue('Subscription', 'DELETE', { id });
        } catch (err) {
            console.error(`❌ Repo: Sub Delete Failed for ID ${id}`, err);
            throw err;
        }
    }
}
