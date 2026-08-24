import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteSubscriptionRepository } from './SqliteSubscriptionRepository.js';

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
    active?: boolean; 
    price?: number;
}

export class NeDBSubscriptionRepository {
    private queue = new QueueService();

    async save(subscription: any): Promise<any> {
        if (!subscription.id) subscription.id = uuidv4();
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
        const normalizedInput = plate.replace(/[\s\-_]/g, '');
        const plateRegex = new RegExp('^[\\s\\-_]*' + [...normalizedInput].join('[\\s\\-_]*') + '[\\s\\-_]*$', 'i');
        return await db.subscriptions.findOne({ plate: { $regex: plateRegex }, active: true });
    }

    async reset(): Promise<void> {
        await db.subscriptions.remove({}, { multi: true });
    }

    async delete(id: string): Promise<void> {
        try {
            await db.subscriptions.remove({ id }, { multi: false });
            await this.queue.enqueue('Subscription', 'DELETE', { id });
        } catch (err) {
            console.error(`❌ Repo: Sub Delete Failed for ID ${id}`, err);
            throw err;
        }
    }
}

export class SubscriptionRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteSubscriptionRepository() : new NeDBSubscriptionRepository();
    }
    async save(subscription: any): Promise<any> { return this.impl.save(subscription); }
    async findAll(): Promise<any[]> { return this.impl.findAll(); }
    async findByCustomerId(customerId: string): Promise<any[]> { return this.impl.findByCustomerId(customerId); }
    async findById(id: string): Promise<any | null> { return this.impl.findById(id); }
    async findActiveByPlate(plate: string): Promise<any | null> { return this.impl.findActiveByPlate(plate); }
    async reset(): Promise<void> { return this.impl.reset(); }
    async delete(id: string): Promise<void> { return this.impl.delete(id); }
}
