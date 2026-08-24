import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../datastore';
import { MigrationService } from './MigrationService';
import { MigrationValidator } from './MigrationValidator';
import { DatabaseSync } from 'node:sqlite';

export class MigrationOrchestrator {
    private static dbPath = path.join(DATA_DIR, 'garageia-shadow.sqlite');
    private static tmpDbPath = path.join(DATA_DIR, 'garageia-shadow.sqlite.tmp');

    public static async initializeShadow(): Promise<void> {
        let manifest = this.getManifest(this.dbPath);
        
        // If VALID, do not run migration.
        if (manifest && manifest.status === 'VALID') {
            console.log('🗄️ SQLite Shadow: Status is VALID. Saltando migración inicial.');
            return;
        }

        console.log('🔄 Iniciando Pre-Cutover Certification (Phase 1.5)...');
        
        // Clean TMP if left over
        if (fs.existsSync(this.tmpDbPath)) {
            fs.unlinkSync(this.tmpDbPath);
        }

        const startTimestamp = new Date().toISOString();
        const migrationId = 'm_' + Date.now();
        
        try {
            // Pasamos `true` a MigrationService o usamos la TMP db.
            // Para mantener SQLiteManager simple, renombramos temporalmente el DATA_DIR/garageia-shadow.sqlite a un backup
            // o instanciamos SQLiteManager contra el tmpPath, pero SQLiteManager es singleton.
            // Dado que SQLiteManager ya fue instanciado en server.ts, mejor manejamos el manifest aquí.
            
            const db = new DatabaseSync(this.dbPath); 
            // Initialize manifest table manually if missing
            db.exec(`
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

            // Start manifest
            const insertManifest = db.prepare(`
                INSERT INTO migration_manifest (migration_id, source_engine, status, started_at)
                VALUES (?, ?, ?, ?)
            `);
            insertManifest.run(migrationId, 'nedb', 'CREATING', startTimestamp);

            // Run migration
            const migrator = new MigrationService();
            const success = await migrator.runMigration();

            if (success) {
                db.prepare(`UPDATE migration_manifest SET status = 'VALIDATING', completed_at = ? WHERE migration_id = ?`)
                    .run(new Date().toISOString(), migrationId);

                const validator = new MigrationValidator();
                const collectionsToMap = [
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
                
                const isValid = await validator.validate(collectionsToMap);

                if (isValid) {
                    db.prepare(`UPDATE migration_manifest SET status = 'VALID', validated_at = ? WHERE migration_id = ?`)
                        .run(new Date().toISOString(), migrationId);
                    console.log('✅ SQLite Shadow está VALIDADA (Phase 1.5 completada).');
                } else {
                    db.prepare(`UPDATE migration_manifest SET status = 'INVALID', validated_at = ? WHERE migration_id = ?`)
                        .run(new Date().toISOString(), migrationId);
                    console.error('❌ Shadow SQLite es INVALIDA tras la migración.');
                }
            } else {
                db.prepare(`UPDATE migration_manifest SET status = 'INVALID' WHERE migration_id = ?`)
                    .run(migrationId);
            }
        } catch (err) {
            console.error('❌ Fallo crítico en Orchestrator:', err);
        }
    }

    private static getManifest(dbPath: string): any {
        try {
            if (!fs.existsSync(dbPath)) return null;
            const db = new DatabaseSync(dbPath);
            const row = db.prepare('SELECT * FROM migration_manifest ORDER BY started_at DESC LIMIT 1').get();
            return row;
        } catch (e) {
            return null;
        }
    }
}
