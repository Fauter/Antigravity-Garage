import { Cochera } from '../../../shared/schemas';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';

export class SqliteCocheraRepository extends BaseSqliteRepository<Cochera> {
    constructor() {
        super('cocheras', 'Cochera');
    }

    async findByGarageId(garageId: string): Promise<Cochera[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM cocheras WHERE json_extract(json_data, '$.garageId') = ?`).all(garageId) as any[];
        return rows.map(r => JSON.parse(r.json_data));
    }

    async findByGarageAndNumber(garageId: string, numero: string): Promise<Cochera | null> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM cocheras WHERE json_extract(json_data, '$.garageId') = ? AND json_extract(json_data, '$.numero') = ?`).all(garageId, numero) as any[];
        if (rows.length === 0) return null;
        return JSON.parse(rows[0].json_data);
    }

    async reset(): Promise<void> {
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec(`DELETE FROM cocheras`);
    }

    async save(cochera: Cochera, externalTx?: any): Promise<Cochera> {
        cochera.updatedAt = new Date();
        const existing = cochera.id ? await this.findById(cochera.id) : null;
        return await super.save(cochera, existing ? 'UPDATE' : 'CREATE', externalTx);
    }
}
