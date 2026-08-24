import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { DATA_DIR } from '../datastore';
import { StorageEngine } from '../StorageEngine';

export class SQLiteManager {
    private db: DatabaseSync;
    private static instance: SQLiteManager;

    private constructor() {
        const engine = StorageEngine.getEngine();
        
        // Determinar archivo dependiendo del Engine actual
        // Para migración/Shadow usamos 'garageia-shadow.sqlite' o tmp. 
        // Para productivo (SQLITE) usamos 'garageia.sqlite'.
        let dbName = 'garageia-shadow.sqlite';
        if (engine === 'SQLITE') {
            dbName = 'garageia.sqlite';
        }

        const dbPath = path.join(DATA_DIR, dbName);
        console.log(`🗄️ SQLite: Inicializando en ${dbPath} (Engine: ${engine})`);
        
        this.db = new DatabaseSync(dbPath);
        
        // 1. Configuraciones de Durabilidad requeridas para Fase 2
        this.db.exec('PRAGMA journal_mode = WAL;'); 
        this.db.exec('PRAGMA synchronous = FULL;'); 
        this.db.exec('PRAGMA foreign_keys = ON;'); 
        this.db.exec('PRAGMA busy_timeout = 5000;'); 
        this.db.exec('PRAGMA wal_autocheckpoint = 1000;'); 

        this.applyMigrations();
    }

    public static getInstance(): SQLiteManager {
        if (!SQLiteManager.instance) {
            SQLiteManager.instance = new SQLiteManager();
        }
        return SQLiteManager.instance;
    }

    // Para testing o reset del singleton
    public static resetInstance(): void {
        if (SQLiteManager.instance) {
            try { SQLiteManager.instance.db.close(); } catch(e){}
            (SQLiteManager as any).instance = undefined;
        }
    }

    public getDatabase(): DatabaseSync {
        return this.db;
    }

    private applyMigrations() {
        // Leer PRAGMA user_version actual
        const currentVersionResult = this.db.prepare('PRAGMA user_version;').get() as { user_version: number };
        const currentVersion = currentVersionResult.user_version;

        console.log(`🗄️ SQLite: Versión actual del Schema = ${currentVersion}`);

        const targetVersion = 2; // Phase 2 V2 Schema

        if (currentVersion < targetVersion) {
            console.log(`🗄️ SQLite: Ejecutando migraciones hacia la versión ${targetVersion}...`);
            this.db.exec('BEGIN TRANSACTION;');
            try {
                if (currentVersion < 1) {
                    const schemaPath1 = path.join(__dirname, 'schema', '001_initial.sql');
                    const schemaSql1 = fs.readFileSync(schemaPath1, 'utf-8');
                    this.db.exec(schemaSql1);

                    this.db.exec(`
                        CREATE TABLE IF NOT EXISTS migration_manifest (
                            migration_id TEXT PRIMARY KEY,
                            source_engine TEXT,
                            source_version TEXT,
                            target_schema_version INTEGER,
                            status TEXT,
                            started_at TEXT,
                            completed_at TEXT,
                            validated_at TEXT,
                            source_fingerprint TEXT,
                            validation_version TEXT
                        );
                    `);
                }

                if (currentVersion < 2) {
                    const schemaPath2 = path.join(__dirname, 'schema', '002_production.sql');
                    // Solo ejecutar 002_production si estamos construyendo garageia.sqlite o garageia-shadow.sqlite.tmp
                    // Si el schema2 es compatible o usa CREATE TABLE IF NOT EXISTS, está bien ejecutarlo.
                    // Pero V2 cambia el PK de _id a id. SQLite no soporta ALTER TABLE para cambiar PKs.
                    // Dado que el "Cutover" borrará la shadow y creará `garageia.sqlite` de cero, 
                    // currentVersion será 0. Así que primero pasará por V1 y luego V2. 
                    // O podemos hacer que V2 sea el único schema si es 0 y el engine es SQLITE.
                    
                    // Dado que creamos un script V2 con puros CREATE TABLE IF NOT EXISTS,
                    // Si ya existían con `_id` como PK (v1), fallará si tratamos de modificar, 
                    // así que V2 asume una DB limpia (o elimina las tablas previas).
                    // Para mayor seguridad, si estamos aplicando V2 sobre una base V1, eliminamos las tablas viejas.
                    
                    const tables = ['garages', 'financial_configs', 'vehicle_types', 'tariffs', 'prices', 'customers', 'vehicles', 'subscriptions', 'cocheras', 'stays', 'movements', 'debts', 'employees', 'shifts', 'partial_closes', 'shift_closes', 'incidents', 'hardware_events', 'promos', 'building_levels', 'sync_state', 'sync_conflicts'];
                    for (const t of tables) {
                        this.db.exec(`DROP TABLE IF EXISTS ${t};`);
                    }
                    this.db.exec(`DROP TABLE IF EXISTS outbox_events;`); // Outbox también cambia su PK
                    
                    const schemaSql2 = fs.readFileSync(schemaPath2, 'utf-8');
                    this.db.exec(schemaSql2);
                }

                this.db.exec(`PRAGMA user_version = ${targetVersion};`);
                this.db.exec('COMMIT;');
                console.log('🗄️ SQLite: Migración de schema exitosa.');
            } catch (error) {
                this.db.exec('ROLLBACK;');
                console.error('❌ SQLite: Error ejecutando migraciones de schema:', error);
                throw error;
            }
        }
    }
}
