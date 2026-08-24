import { Movement } from '../../../shared/schemas';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';

export class SqliteMovementRepository extends BaseSqliteRepository<Movement> {
    constructor() {
        super('movements', 'Movement');
    }

    async findByShiftId(shiftId: string): Promise<Movement[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM movements WHERE json_extract(json_data, '$.shiftId') = ?`).all(shiftId) as any[];
        return rows.map(r => JSON.parse(r.json_data));
    }

    async reset(): Promise<void> {
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec(`DELETE FROM movements`);
    }

    async findAll(): Promise<Movement[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM movements`).all() as any[];
        return rows
            .map(r => JSON.parse(r.json_data))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
}
