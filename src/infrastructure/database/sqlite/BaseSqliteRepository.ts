import { SQLiteManager } from './SQLiteManager';
import { TransactionHelper } from './TransactionHelper';
import { v4 as uuidv4 } from 'uuid';

export abstract class BaseSqliteRepository<T extends { id?: string; _id?: string }> {
    
    constructor(
        protected tableName: string,
        protected entityType: string
    ) {}

    protected get db() {
        return SQLiteManager.getInstance().getDatabase();
    }

    protected generateOutboxEvent(entityId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any = null) {
        return {
            event_id: uuidv4(),
            entity_type: this.entityType,
            entity_id: entityId,
            operation,
            payload: payload ? JSON.stringify(payload) : null,
            status: 'PENDING',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
    }

    protected insertOutboxEvent(tx: any, event: any) {
        tx.prepare(`
            INSERT INTO outbox_events 
            (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            event.event_id, event.entity_type, event.entity_id, event.operation,
            event.payload, event.status, event.created_at, event.updated_at
        );
    }

    public async findById(id: string): Promise<T | null> {
        const row = this.db.prepare(`SELECT json_data FROM ${this.tableName} WHERE id = ?`).get(id) as any;
        if (!row) return null;
        return { id, ...JSON.parse(row.json_data) };
    }

    public async findAll(): Promise<T[]> {
        const rows = this.db.prepare(`SELECT id, json_data FROM ${this.tableName}`).all() as any[];
        return rows.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
    }

    // Default atomic upsert
    public async save(entity: T, operation: 'CREATE' | 'UPDATE' = 'UPDATE'): Promise<T> {
        if (!entity.id && !entity._id) {
            entity.id = uuidv4();
            operation = 'CREATE';
        }
        const id = (entity.id || entity._id) as string;
        entity.id = id;
        delete entity._id; // Drop legacy NeDB ID in SQLite

        const payloadStr = JSON.stringify(entity);
        const event = this.generateOutboxEvent(id, operation, entity);

        TransactionHelper.run((tx) => {
            tx.prepare(`
                INSERT INTO ${this.tableName} (id, json_data) VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
            `).run(id, payloadStr);
            this.insertOutboxEvent(tx, event);
        });

        return entity;
    }

    // Default atomic delete
    public async delete(id: string): Promise<void> {
        const event = this.generateOutboxEvent(id, 'DELETE');
        
        TransactionHelper.run((tx) => {
            tx.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
            this.insertOutboxEvent(tx, event);
        });
    }
}
