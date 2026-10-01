import { Customer } from '../../../shared/schemas';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';

export class SqliteCustomerRepository extends BaseSqliteRepository<Customer> {
    constructor() {
        super('customers', 'Customer');
    }

    async findByDni(dni: string, garageId?: string): Promise<Customer | null> {
        const db = SQLiteManager.getInstance().getDatabase();
        let query = `SELECT json_data FROM customers WHERE json_extract(json_data, '$.dni') = ?`;
        const params: any[] = [dni];
        
        if (garageId) {
            query += ` AND json_extract(json_data, '$.garageId') = ?`;
            params.push(garageId);
        }
        
        const row = db.prepare(query).get(...params) as any;
        if (!row) return null;
        return JSON.parse(row.json_data);
    }

    async reset(): Promise<void> {
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec(`DELETE FROM customers`);
    }
}
