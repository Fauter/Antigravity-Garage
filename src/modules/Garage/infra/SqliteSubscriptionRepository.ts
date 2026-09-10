import { Subscription } from './SubscriptionRepository';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';

export class SqliteSubscriptionRepository extends BaseSqliteRepository<Subscription> {
    constructor() {
        super('subscriptions', 'Subscription');
    }

    async findByCustomerId(customerId: string): Promise<any[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM subscriptions WHERE json_extract(json_data, '$.customerId') = ?`).all(customerId) as any[];
        return rows.map(r => JSON.parse(r.json_data));
    }

    async findActiveByPlate(plate: string, garageId?: string): Promise<any | null> {
        const normalizedInput = plate.replace(/[\s\-_]/g, '').toLowerCase();
        
        const db = SQLiteManager.getInstance().getDatabase();
        let sql = `SELECT json_data FROM subscriptions WHERE json_extract(json_data, '$.active') = true`;
        const params: any[] = [];
        
        if (garageId) {
            sql += ` AND (json_extract(json_data, '$.cocheraId') = ? OR json_extract(json_data, '$.cochera_id') = ?)`;
            params.push(garageId, garageId);
        }
        
        const rows = db.prepare(sql).all(...params) as any[];
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        for (const sub of parsed) {
            if (sub.plate) {
                const subPlateNorm = sub.plate.replace(/[\s\-_]/g, '').toLowerCase();
                if (subPlateNorm === normalizedInput) {
                    return sub;
                }
            }
        }
        return null;
    }

    async reset(): Promise<void> {
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec(`DELETE FROM subscriptions`);
    }
}
