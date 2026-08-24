import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { db } from '../src/infrastructure/database/datastore';
import { MigrationService } from '../src/infrastructure/database/sqlite/MigrationService';
import { MigrationValidator } from '../src/infrastructure/database/sqlite/MigrationValidator';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../src/infrastructure/database/datastore';

describe('Phase 1 SQLite Shadow Migration', () => {
    let migrator: MigrationService;
    let validator: MigrationValidator;
    
    beforeAll(async () => {
        // Clear NeDB and seed dummy data
        await Promise.all([
            db.stays.remove({}, { multi: true }),
            db.movements.remove({}, { multi: true }),
            db.mutations.remove({}, { multi: true })
        ]);

        await db.stays.insert({ id: 'stay_1', plate: 'AAA111', amountPaid: 1500.50 });
        await db.movements.insert({ id: 'mov_1', amount: 500, type: 'INCOME' });
        await db.movements.insert({ id: 'mov_2', amount: 1000.25, type: 'INCOME' });
        await db.mutations.insert({ id: 'mut_1', entityType: 'Stay', entityId: 'stay_1', operation: 'INSERT', status: 'PENDING' });

        migrator = new MigrationService();
        validator = new MigrationValidator();
    });

    afterAll(async () => {
        // Cleanup Shadow DB
        const dbPath = path.join(DATA_DIR, 'garageia-shadow.sqlite');
        try { fs.unlinkSync(dbPath); } catch (e) {}
    });

    it('TEST A: Successful Migration of Core Entities', async () => {
        const success = await migrator.runMigration();
        expect(success).toBe(true);

        const counts = migrator.getCounts();
        expect(counts.get('stays')?.sqlite).toBe(1);
        expect(counts.get('movements')?.sqlite).toBe(2);
        expect(counts.get('outbox_events')?.sqlite).toBe(1);
    });

    it('TEST B: Parity Validations (Count, Financial, ID)', async () => {
        const isValid = await validator.validate([
            { nedb: 'stays', table: 'stays' },
            { nedb: 'movements', table: 'movements' }
        ]);
        expect(isValid).toBe(true);
        expect(validator.getDiscrepancies().length).toBe(0);
    });

    it('TEST C: Financial Checksum Detection (Modifying Shadow DB)', async () => {
        const sqlite = SQLiteManager.getInstance().getDatabase();
        // Modify amount directly in sqlite to break parity
        sqlite.exec("UPDATE movements SET amount = 9999 WHERE id = 'mov_1'");
        
        const isStillValid = await validator.validate([
            { nedb: 'movements', table: 'movements' }
        ]);
        
        expect(isStillValid).toBe(false);
        const discrepancies = validator.getDiscrepancies();
        expect(discrepancies.length).toBeGreaterThan(0);
        expect(discrepancies.some(d => d.includes('Financial mismatch'))).toBe(true);
    });

    it('TEST D: Transactional Fallback (Crashing midway)', async () => {
        const migratorBroken = new MigrationService();
        
        // Mock a fatal error durante migration
        vi.spyOn(migratorBroken as any, 'migrateCollection').mockRejectedValueOnce(new Error('Fatal I/O Error'));
        
        const success = await migratorBroken.runMigration();
        expect(success).toBe(false);

        // SQLite debe hacer ROLLBACK, asegurando que queda protegida
        const sqlite = SQLiteManager.getInstance().getDatabase();
        // Como falló a la mitad, no debería existir manifest VALID
        const manifest = sqlite.prepare('SELECT status FROM migration_manifest ORDER BY started_at DESC LIMIT 1').get() as {status: string};
        expect(manifest?.status).not.toBe('VALID');
    });

    it('TEST E: Orchestrator Blocking and Snapshot Consistency', async () => {
        // En lugar de iniciar Express al instante, el Orchestrator bloquea
        // Si ya hay un shadow VALID, termina instantáneo
        const start = Date.now();
        await MigrationOrchestrator.initializeShadow();
        const duration = Date.now() - start;
        
        // Debe ser súper rápido porque ya está migrado en el TEST A/B
        expect(duration).toBeLessThan(1500); 

        const sqlite = SQLiteManager.getInstance().getDatabase();
        const manifest = sqlite.prepare('SELECT status FROM migration_manifest ORDER BY started_at DESC LIMIT 1').get() as {status: string};
        expect(manifest.status).toBe('VALID');
    });
});
