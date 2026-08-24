import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository.js';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager.js';

export class NeDBIncidentRepository {
    private queue = new QueueService();

    async save(incident: any): Promise<any> {
        await db.incidents.insert(incident);
        await this.queue.enqueue('Incident', 'CREATE', incident);
        return incident;
    }
}

export class SqliteIncidentRepository extends BaseSqliteRepository<any> {
    constructor() {
        super('incidents', 'Incident');
    }

    async save(incident: any): Promise<any> {
        return await super.save(incident, 'CREATE');
    }
}

export class IncidentRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteIncidentRepository() : new NeDBIncidentRepository();
    }
    async save(incident: any) { return this.impl.save(incident); }
}
