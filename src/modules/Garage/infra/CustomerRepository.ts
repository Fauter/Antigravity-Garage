import { Customer } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';

export class CustomerRepository {
    private queue = new QueueService();

    async save(customer: Customer): Promise<Customer> {
        if (!customer.id) {
            customer.id = uuidv4();
        }

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
