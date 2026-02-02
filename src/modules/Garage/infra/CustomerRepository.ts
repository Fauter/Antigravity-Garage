import { CustomerModel } from '../../../infrastructure/database/models';
import { Customer } from '../../../shared/schemas';

export class CustomerRepository {
    async save(customer: Customer): Promise<Customer> {
        const result = await CustomerModel.findOneAndUpdate(
            { id: customer.id },
            customer,
            { new: true, upsert: true }
        );
        return result.toObject() as Customer;
    }

    async findById(id: string): Promise<Customer | null> {
        const result = await CustomerModel.findOne({ id });
        return result ? (result.toObject() as Customer) : null;
    }

    async findByDni(dni: string): Promise<Customer | null> {
        const result = await CustomerModel.findOne({ dni });
        return result ? (result.toObject() as Customer) : null;
    }
}
