import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository.js';

export class NeDBShiftCloseRepository {
    private queue = new QueueService();

    async save(shiftClose: any): Promise<any> {
        await db.shiftCloses.insert(shiftClose);
        await this.queue.enqueue('ShiftClose', 'CREATE', shiftClose);
        return shiftClose;
    }
}

export class SqliteShiftCloseRepository extends BaseSqliteRepository<any> {
    constructor() {
        super('shift_closes', 'ShiftClose');
    }

    async save(shiftClose: any): Promise<any> {
        return await super.save(shiftClose, 'CREATE');
    }
    
    async findAll(): Promise<any[]> {
        const db = require('../../../infrastructure/database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase();
        return db.prepare('SELECT json_data FROM shift_closes').all().map((r: any) => JSON.parse(r.json_data));
    }
}

export class ShiftCloseRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteShiftCloseRepository() : new NeDBShiftCloseRepository();
    }
    async save(shiftClose: any): Promise<any> { return this.impl.save(shiftClose); }
    async findAll(): Promise<any[]> { return this.impl.findAll ? this.impl.findAll() : []; }
}
