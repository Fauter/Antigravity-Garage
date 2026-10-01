import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository.js';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager.js';

export class NeDBPartialCloseRepository {
    private queue = new QueueService();

    async save(partialClose: any): Promise<any> {
        await db.partialCloses.insert(partialClose);
        await this.queue.enqueue('PartialClose', 'CREATE', partialClose);
        return partialClose;
    }

    async findAll(): Promise<any[]> {
        return await db.partialCloses.find({}).sort({ timestamp: -1 }) as any[];
    }
}

export class SqlitePartialCloseRepository extends BaseSqliteRepository<any> {
    constructor() {
        super('partial_closes', 'PartialClose');
    }

    async save(partialClose: any): Promise<any> {
        return await super.save(partialClose, 'CREATE');
    }
    
    async findAll(): Promise<any[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        return db.prepare('SELECT json_data FROM partial_closes').all().map((r: any) => JSON.parse(r.json_data));
    }
}

export class PartialCloseRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqlitePartialCloseRepository() : new NeDBPartialCloseRepository();
    }
    async save(partialClose: any): Promise<any> { return this.impl.save(partialClose); }
    async findAll(): Promise<any[]> { return this.impl.findAll ? this.impl.findAll() : []; }
}
