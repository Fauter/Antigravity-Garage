import { SQLiteManager } from './SQLiteManager';
import { TransactionHelper } from './TransactionHelper';
import { CanonicalEntityHelper } from './CanonicalEntityHelper';
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
        let row = this.db.prepare(`SELECT id, json_data FROM ${this.tableName} WHERE id = ?`).get(id) as any;
        if (!row) {
            // COMPATIBILITY: Fallback to logical ID for NeDB-migrated rows that haven't been reconciled yet.
            // DO NOT make this permanent architecture; it should be removed after DB is fully reconciled.
            row = this.db.prepare(`SELECT id, json_data FROM ${this.tableName} WHERE json_extract(json_data, '$.id') = ?`).get(id) as any;
            if (!row) return null;
        }
        const parsed = JSON.parse(row.json_data);
        return { id: parsed.id || row.id, ...parsed };
    }

    public async findAll(): Promise<T[]> {
        const rows = this.db.prepare(`SELECT id, json_data FROM ${this.tableName}`).all() as any[];
        const parsedRows = rows.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
        return CanonicalEntityHelper.resolveCanonical<T>(parsedRows, this.entityType);
    }

    // Default atomic upsert
    public async save(entity: T, arg2?: any, arg3?: any): Promise<T> {
        let operation: 'CREATE' | 'UPDATE' = 'UPDATE';
        let externalTx: any = undefined;

        if (arg2 && typeof arg2 === 'string') {
            operation = arg2 as 'CREATE' | 'UPDATE';
            externalTx = arg3;
        } else if (arg2 && typeof arg2 === 'object') {
            externalTx = arg2;
        }

        if (!entity.id && !entity._id) {
            entity.id = uuidv4();
            operation = 'CREATE';
        }
        const id = (entity.id || entity._id) as string;
        entity.id = id;
        delete entity._id; // Drop legacy NeDB ID in SQLite

        const payloadStr = JSON.stringify(entity);
        const event = this.generateOutboxEvent(id, operation, entity);

        const execute = (tx: any) => {
            // Check for legacy duplicate before upserting the canonical UUID row
            const legacyCheck = tx.prepare(`SELECT id FROM ${this.tableName} WHERE json_extract(json_data, '$.id') = ? AND id != ?`).get(id, id) as any;
            if (legacyCheck) {
                tx.prepare(`
                    UPDATE ${this.tableName} SET json_data = ? WHERE id = ?
                `).run(payloadStr, legacyCheck.id);
            } else {
                tx.prepare(`
                    INSERT INTO ${this.tableName} (id, json_data) VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
                `).run(id, payloadStr);
            }
            console.log(`[DEBUG] Saved to ${this.tableName}, ID: ${id}, TX? ${!!externalTx}`);
            this.insertOutboxEvent(tx, event);
        };

        if (externalTx) {
            execute(externalTx);
        } else {
            TransactionHelper.run(execute);
        }

        return entity;
    }

    // Default atomic delete
    public async delete(id: string, externalTx?: any): Promise<void> {
        const event = this.generateOutboxEvent(id, 'DELETE');
        
        const execute = (tx: any) => {
            tx.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
            this.insertOutboxEvent(tx, event);
        };

        if (externalTx) {
            execute(externalTx);
        } else {
            TransactionHelper.run(execute);
        }
    }
}
