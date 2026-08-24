import { db as NeDBStore } from '../datastore';
import { SQLiteManager } from './SQLiteManager';

// Tipos permitidos en SQLite nativo
type SQLiteValue = string | number | null;

export class MigrationService {
    private sqlite = SQLiteManager.getInstance().getDatabase();
    private counts = new Map<string, { nedb: number, sqlite: number }>();
    private legacyWarnings: string[] = [];

    // Colecciones a migrar. Mapea la colección de NeDB al nombre de la tabla SQLite.
    private collections = [
        { nedb: 'garages', table: 'garages' },
        { nedb: 'financialConfigs', table: 'financial_configs' },
        { nedb: 'vehicleTypes', table: 'vehicle_types' },
        { nedb: 'tariffs', table: 'tariffs' },
        { nedb: 'prices', table: 'prices' },
        { nedb: 'customers', table: 'customers' },
        { nedb: 'vehicles', table: 'vehicles' },
        { nedb: 'subscriptions', table: 'subscriptions' },
        { nedb: 'cocheras', table: 'cocheras' },
        { nedb: 'stays', table: 'stays' },
        { nedb: 'movements', table: 'movements' },
        { nedb: 'debts', table: 'debts' },
        { nedb: 'employees', table: 'employees' },
        { nedb: 'shifts', table: 'shifts' },
        { nedb: 'partialCloses', table: 'partial_closes' },
        { nedb: 'shiftCloses', table: 'shift_closes' },
        { nedb: 'incidents', table: 'incidents' },
        { nedb: 'hardwareEvents', table: 'hardware_events' },
        { nedb: 'promos', table: 'promos' },
        { nedb: 'buildingLevels', table: 'building_levels' },
        { nedb: 'syncConflicts', table: 'sync_conflicts' },
        { nedb: 'syncState', table: 'sync_state' }
    ];

    public async runMigration(): Promise<boolean> {
        console.log('🔄 Iniciando Shadow Migration de NeDB a SQLite...');
        const startTime = Date.now();

        // Limpiar base de datos destino si es que ya existía (Shadow debe recrearse en cada intento hasta que validemos dual write)
        this.clearSQLite();

        // Desactivamos temporalmente las FK para tolerar huérfanos legacy. Serán auditados por validator.
        // Importante: SQLite requiere que esto se haga FUERA de una transacción.
        this.sqlite.exec('PRAGMA foreign_keys = OFF;');
        this.sqlite.exec('BEGIN TRANSACTION;');

        try {
            for (const { nedb, table } of this.collections) {
                await this.migrateCollection(nedb, table);
            }
            
            // Migrar outbox (mutations)
            await this.migrateMutations();

            this.sqlite.exec('COMMIT;');
            this.sqlite.exec('PRAGMA foreign_keys = ON;');
            console.log(`✅ Shadow Migration completada en ${Date.now() - startTime}ms.`);
            return true;
        } catch (error) {
            this.sqlite.exec('ROLLBACK;');
            this.sqlite.exec('PRAGMA foreign_keys = ON;');
            console.error('❌ Error crítico durante la migración, ejecutando ROLLBACK:', error);
            return false;
        }
    }

    private clearSQLite() {
        this.sqlite.exec('BEGIN TRANSACTION;');
        try {
            // Deshabilitar FK checking durante el limpiado
            this.sqlite.exec('PRAGMA foreign_keys = OFF;');
            
            this.sqlite.exec('DELETE FROM outbox_events;');
            
            const reversed = [...this.collections].reverse();
            for (const { table } of reversed) {
                this.sqlite.exec(`DELETE FROM ${table};`);
            }
            
            this.sqlite.exec('PRAGMA foreign_keys = ON;');
            this.sqlite.exec('COMMIT;');
        } catch (error) {
            this.sqlite.exec('ROLLBACK;');
            this.sqlite.exec('PRAGMA foreign_keys = ON;');
            console.error('❌ Error limpiando SQLite:', error);
        }
    }

    private async migrateCollection(nedbName: string, tableName: string) {
        // @ts-ignore
        const nedbStore = NeDBStore[nedbName];
        if (!nedbStore) {
            console.warn(`⚠️ Colección ${nedbName} no encontrada en datastore.`);
            return;
        }

        const docs = await nedbStore.find({});
        
        if (docs.length === 0) {
            this.counts.set(tableName, { nedb: 0, sqlite: 0 });
            return;
        }

        console.log(`📦 Migrando ${docs.length} registros de ${nedbName} -> ${tableName}`);

        // Usamos una sentencia preparada para inserción masiva. SQLiteSync no soporta array binding directo,
        // así que iteramos o usamos inserciones.
        const firstDoc = docs[0];
        
        // Obtenemos las columnas válidas para esta tabla leyendo del schema real
        const tableInfo = this.sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as {name: string}[];
        const validColumns = new Set(tableInfo.map(c => c.name));

        const insertStmt = this.sqlite.prepare(`
            INSERT INTO ${tableName} (${Array.from(validColumns).join(', ')})
            VALUES (${Array.from(validColumns).map(() => '?').join(', ')})
        `);

        for (const doc of docs) {
            const mapped = this.mapDocumentToSQLite(doc, validColumns, tableName);
            const values = Array.from(validColumns).map(col => mapped[col]);
            
            try {
                insertStmt.run(...values);
            } catch (err: any) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    console.error(`🚨 UNIQUE constraint failed on ${tableName}:`, doc);
                    throw err;
                } else if (err.message.includes('FOREIGN KEY')) {
                    this.legacyWarnings.push(`[FK Violation] Tabla ${tableName}, ID ${doc.id || doc._id}: ${err.message}`);
                    throw err; 
                } else {
                    throw err;
                }
            }
        }
        
        this.counts.set(tableName, { nedb: docs.length, sqlite: docs.length });
    }

    private async migrateMutations() {
        const docs = await NeDBStore.mutations.find({}) as any[];
        console.log(`📦 Migrando ${docs.length} operaciones pendientes (mutations) -> outbox_events`);
        
        if (docs.length === 0) {
            this.counts.set('outbox_events', { nedb: 0, sqlite: 0 });
            return;
        }

        const insertStmt = this.sqlite.prepare(`
            INSERT INTO outbox_events (
                event_id, entity_type, entity_id, operation, payload, status, 
                attempts, last_error_code, last_error, next_attempt_at, acked_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const doc of docs) {
            // Conversión estricta de Legacy Mutation a Outbox Event
            const payloadStr = doc.payload ? JSON.stringify(doc.payload) : null;
            
            // Legacy mapping status
            let status = doc.status || 'PENDING';
            if (doc.synced && status !== 'ACKED') status = 'ACKED';

            insertStmt.run(
                doc.id || doc._id,
                doc.entityType,
                doc.entityId || 'UNKNOWN',
                doc.operation || 'UPDATE',
                payloadStr,
                status,
                doc.retryCount || 0,
                doc.lastErrorCode || null,
                doc.lastError || null,
                this.normalizeDate(doc.nextAttemptAt),
                this.normalizeDate(doc.ackedAt),
                this.normalizeDate(doc.createdAt),
                this.normalizeDate(doc.updatedAt)
            );
        }
        
        this.counts.set('outbox_events', { nedb: docs.length, sqlite: docs.length });
    }

    private mapDocumentToSQLite(doc: any, validColumns: Set<string>, tableName: string): Record<string, SQLiteValue> {
        const result: Record<string, SQLiteValue> = {};
        const jsonData: Record<string, any> = {};

        // Mapeo especial para columnas de camelCase a snake_case
        const snakeCaseMap: Record<string, any> = {};
        for (const key of Object.keys(doc)) {
            // Convertir camelCase a snake_case
            const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            snakeCaseMap[snakeKey] = doc[key];
        }

        // Poblar columnas válidas
        for (const col of validColumns) {
            if (col === 'json_data') continue; // Llenado al final
            
            let val = snakeCaseMap[col] !== undefined ? snakeCaseMap[col] : null;

            // Manejo de tipos específicos
            if (val instanceof Date) {
                val = val.toISOString();
            } else if (typeof val === 'boolean') {
                val = val ? 1 : 0;
            } else if (typeof val === 'object' && val !== null) {
                val = JSON.stringify(val);
            }

            result[col] = val;
            delete snakeCaseMap[col];
        }

        // Todo lo sobrante va a json_data
        for (const key of Object.keys(snakeCaseMap)) {
            jsonData[key] = snakeCaseMap[key];
        }

        if (Object.keys(jsonData).length > 0) {
            result['json_data'] = JSON.stringify(jsonData);
        } else {
            result['json_data'] = null;
        }

        return result;
    }

    private normalizeDate(val: any): string | null {
        if (!val) return null;
        if (val instanceof Date) return val.toISOString();
        return new Date(val).toISOString();
    }

    public getCounts() {
        return this.counts;
    }
}
