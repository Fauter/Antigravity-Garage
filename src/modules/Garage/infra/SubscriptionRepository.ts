import { JsonDB } from '../../../infrastructure/database/json-db';

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
}

export class SubscriptionRepository {
    private db: JsonDB<Subscription>;

    constructor() {
        this.db = new JsonDB<Subscription>('abonos');
    }

    async create(subscription: any): Promise<void> {
        await this.db.create(subscription);
    }

    async save(subscription: any): Promise<any> {
        await this.db.create(subscription);
        return subscription;
    }

    async findAll(): Promise<any[]> {
        return await this.db.find({});
    }

    async getAll(): Promise<any[]> {
        return await this.db.find({});
    }

    async findByCustomerId(customerId: string): Promise<any[]> {
        return await this.db.find({ customerId });
    }

    async findActiveByPlate(plate: string): Promise<any | null> {
        // Mock logic using filtered find
        const all = await this.db.find({ plate });
        return all.find(s => s.status === 'active') || null;
    }

    async reset(): Promise<void> {
        await this.db.reset();
    }
}
