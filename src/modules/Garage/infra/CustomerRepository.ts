import { Customer } from '../../../shared/schemas';
import { JsonDB } from '../../../infrastructure/database/json-db';

const customerDB = new JsonDB<Customer>('customers');

export class CustomerRepository {
    async save(customer: Customer): Promise<Customer> {
        // Validation: Ensure ID
        if (!customer.id) {
            throw new Error("Customer ID is required for save");
        }

        const existing = await customerDB.getById(customer.id);
        if (existing) {
            await customerDB.updateOne({ id: customer.id }, customer);
        } else {
            await customerDB.create(customer);
        }
        return customer;
    }

    async findById(id: string): Promise<Customer | null> {
        return await customerDB.getById(id);
    }

    async findByDni(dni: string): Promise<Customer | null> {
        const all = await customerDB.getAll();
        return all.find(c => c.dni === dni) || null;
    }

    async findAll(): Promise<Customer[]> {
        return await customerDB.getAll();
    }

    async reset(): Promise<void> {
        await customerDB.reset();
    }
}
