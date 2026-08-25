import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { DATA_DIR } from '../datastore';
import { StorageEngine } from '../StorageEngine';
import { FRESH_SCHEMA, DOMAIN_TABLES } from './schema/index';

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
        
        try {
            // 1. Configuraciones de Durabilidad requeridas para Fase 2
            this.db.exec('PRAGMA journal_mode = WAL;'); 
            this.db.exec('PRAGMA synchronous = FULL;'); 
            this.db.exec('PRAGMA foreign_keys = ON;'); 
            this.db.exec('PRAGMA busy_timeout = 5000;'); 
            this.db.exec('PRAGMA wal_autocheckpoint = 1000;'); 

            this.applyMigrations();
        } catch (e) {
            this.db.close();
            throw e;
        }
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

    public createBackup(destinationPath: string): void {
        console.log(`🗄️ SQLite: Creating safe WAL-compatible backup at ${destinationPath}`);
        if (fs.existsSync(destinationPath)) {
            fs.unlinkSync(destinationPath);
        }
        // VACUUM INTO safely creates a consistent copy including the current WAL state
        this.db.exec(`VACUUM INTO '${destinationPath}';`);
    }

    private applyMigrations() {
        const currentVersionResult = this.db.prepare('PRAGMA user_version;').get() as { user_version: number };
        const currentVersion = currentVersionResult.user_version;
        const targetVersion = 3; // Phase 3 V3 Schema (Attachments)

        console.log(`🗄️ SQLite: Versión actual del Schema = ${currentVersion}, Esperado = ${targetVersion}`);

        if (currentVersion === targetVersion) return;

        console.log(`🗄️ SQLite: Ejecutando migraciones hacia la versión ${targetVersion}...`);
        this.db.exec('BEGIN IMMEDIATE;');
        try {
            if (currentVersion === 0) {
                // Determine if it's a completely fresh DB or a legacy Shadow DB that forgot to set user_version
                const tablesInfo = this.db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='garages'").get() as any;
                
                if (tablesInfo.count === 0) {
                    if (StorageEngine.getEngine() === 'SQLITE') {
                        if (process.env.VITEST && !process.env.TEST_DISASTER) {
                            console.warn('⚠️ [TEST] Bypassing Disaster Recovery Safety Stop in vitest.');
                        } else {
                            // GATE 2: DISASTER DETECTED
                            // We are in SQLITE mode, but the tables are completely missing.
                            // This means garageia.sqlite was deleted or corrupted and recreated empty by node:sqlite.
                            console.error('🚨 [DISASTER RECOVERY] SQLITE mode active but garageia.sqlite is empty or missing! SAFETY STOP.');
                            throw new Error('SAFETY STOP: Local database missing but engine is SQLITE.');
                        }
                    }

                    // 1. FRESH INSTALL (or completely fresh cutover db)
                    this.db.exec(FRESH_SCHEMA);
                    this.db.exec(`PRAGMA user_version = ${targetVersion};`);
                    this.db.exec('COMMIT;');
                    console.log('🗄️ SQLite: Fresh schema creado exitosamente.');
                    return;
                }
                // If tables exist, it's a legacy V1 Shadow DB without user_version set. Fall through to upgrade.
            }

            // 2. INCREMENTAL MIGRATIONS (Preserves data)
            if (currentVersion < 2) {
                this.runMigration1to2();
            }

            if (currentVersion < 3) {
                this.runMigration2to3();
            }

            this.db.exec(`PRAGMA user_version = ${targetVersion};`);
            this.db.exec('COMMIT;');
            console.log('🗄️ SQLite: Migración de schema exitosa a V3 sin pérdida de datos.');
        } catch (error) {
            this.db.exec('ROLLBACK;');
            console.error('❌ SQLite: Error ejecutando migraciones de schema:', error);
            throw error;
        }
    }

    private runMigration2to3() {
        console.log('🗄️ Ejecutando Migración V2 -> V3 (Attachments Queue)...');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS attachments_outbox (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                field_name TEXT NOT NULL,
                local_path TEXT NOT NULL,
                remote_bucket TEXT NOT NULL,
                remote_path TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT
            );
        `);
    }

    private runMigration1to2() {
        for (const table of DOMAIN_TABLES) {
            const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
            // If the table already has ONLY id and json_data, it's already V2! Skip!
            if (columns.length === 2 && columns.find(c => c.name === 'id') && columns.find(c => c.name === 'json_data')) {
                continue;
            }

            const colNames = columns.map(c => c.name);
            const colsWithoutJson = colNames.filter(c => c !== 'json_data');
            const jsonObjArgs = colsWithoutJson.map(c => `'${c}', ${c}`).join(', ');

            this.db.exec(`
                CREATE TABLE ${table}_v2 (
                    id TEXT PRIMARY KEY,
                    json_data TEXT
                );
                
                INSERT INTO ${table}_v2 (id, json_data)
                SELECT 
                    COALESCE(id, _id, hex(randomblob(16))) as final_id,
                    json_patch(
                        COALESCE(json_data, '{}'),
                        json_object('id', COALESCE(id, _id, hex(randomblob(16))))
                    )
                FROM ${table};
                
                DROP TABLE ${table};
                ALTER TABLE ${table}_v2 RENAME TO ${table};
            `);
        }
        
        // Also ensure system tables are created if they don't exist
        // We can execute FRESH_SCHEMA again safely because it uses IF NOT EXISTS, 
        // and domain tables are already migrated and won't be touched by IF NOT EXISTS!
        this.db.exec(FRESH_SCHEMA);
    }
}
