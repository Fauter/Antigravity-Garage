import { Customer } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteCustomerRepository } from './SqliteCustomerRepository.js';

export class NeDBCustomerRepository {
    private queue = new QueueService();

    async save(customer: Customer): Promise<Customer> {
        if (!customer.id) customer.id = uuidv4();
        try {
            await db.customers.update({ id: customer.id }, customer, { upsert: true });
            console.log(`💾 Repo: Customer Saved Local (${customer.id})`);
        } catch (err) {
            console.error('❌ Repo: Customer Save Failed', err);
            throw err;
        }
        await this.queue.enqueue('Customer', 'UPDATE', customer);
        return customer;
    }

    async findById(id: string): Promise<Customer | null> {
        return await db.customers.findOne({ id }) as Customer | null;
    }

    async findByDni(dni: string): Promise<Customer | null> {
        return await db.customers.findOne({ dni }) as Customer | null;
    }

    async findAll(): Promise<Customer[]> {
        return await db.customers.find({}) as Customer[];
    }

    async reset(): Promise<void> {
        await db.customers.remove({}, { multi: true });
    }
}

export class CustomerRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteCustomerRepository() : new NeDBCustomerRepository();
    }
    async save(customer: Customer, tx?: any): Promise<Customer> { return this.impl.save(customer, tx); }
    async findById(id: string): Promise<Customer | null> { return this.impl.findById(id); }
    async findByDni(dni: string): Promise<Customer | null> { return this.impl.findByDni(dni); }
    async findAll(): Promise<Customer[]> { return this.impl.findAll(); }
    async reset(): Promise<void> { return this.impl.reset(); }
}
