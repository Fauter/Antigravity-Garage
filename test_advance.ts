import { SQLiteManager } from './src/infrastructure/database/sqlite/SQLiteManager.js';
import { TransactionHelper } from './src/infrastructure/database/sqlite/TransactionHelper.js';
import { BaseSqliteRepository } from './src/infrastructure/database/sqlite/BaseSqliteRepository.js';

class DummyRepo extends BaseSqliteRepository<any> {
    constructor(tableName: string) { super(tableName, 'Dummy'); }
}

async function test() {
    const db = SQLiteManager.getInstance().getDatabase();
    
    db.exec(`CREATE TABLE IF NOT EXISTS dummy_movements (id TEXT PRIMARY KEY, json_data TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS outbox_events (event_id TEXT, entity_type TEXT, entity_id TEXT, operation TEXT, payload TEXT, status TEXT, created_at TEXT, updated_at TEXT)`);

    const repo = new DummyRepo('dummy_movements');
    
    try {
        await TransactionHelper.runAsync(async (txDb: any) => {
            console.log('Inside runAsync');
            await repo.save({ id: '123', data: 'hello' } as any, txDb);
            console.log('Saved');
        });
        
        const row = db.prepare(`SELECT * FROM dummy_movements`).all();
        console.log('Movements:', row);
        
        const outbox = db.prepare(`SELECT * FROM outbox_events`).all();
        console.log('Outbox:', outbox);
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
