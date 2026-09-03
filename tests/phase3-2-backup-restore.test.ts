import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { db } from '../src/infrastructure/database/datastore';
import { FRESH_SCHEMA } from '../src/infrastructure/database/sqlite/schema/index';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

describe('PHASE 3.2 - BACKUP AND RESTORE DRILL', () => {
    let sqlite: any;
    const testDir = path.join(process.cwd(), '.data', 'test');
    const backupPath = path.join(testDir, 'test_garageia_backup_drill.sqlite');
    const originalPath = path.join(testDir, 'test_garageia_backup_original.sqlite');
    const corruptedPath = path.join(testDir, 'test_garageia_backup_corrupted.sqlite');

    beforeAll(() => {
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        // Ensure fresh start
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        if (fs.existsSync(corruptedPath)) fs.unlinkSync(corruptedPath);

        // Mock SQLITE engine
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');

        // Initialize a valid database manually to bypass SAFETY STOP
        const tempDb = new DatabaseSync(originalPath);
        tempDb.exec(FRESH_SCHEMA);
        tempDb.exec('PRAGMA user_version = 3;');
        tempDb.close();

        SQLiteManager.resetInstance();
        sqlite = SQLiteManager.initForTest(originalPath).getDatabase();
    });

    afterAll(() => {
        vi.restoreAllMocks();
        SQLiteManager.resetInstance();
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        if (fs.existsSync(corruptedPath)) fs.unlinkSync(corruptedPath);
    });

    it('G7: Creates a WAL-compatible backup, destroys original, and successfully restores all states', async () => {
        // 1. POPULATE DB
        sqlite.exec('DELETE FROM vehicles;');
        sqlite.exec('DELETE FROM outbox_events;');
        sqlite.exec('DELETE FROM attachments_outbox;');

        sqlite.exec(`INSERT INTO vehicles (id, json_data) VALUES ('veh_1', '{"plate":"BKUP"}');`);
        sqlite.exec(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES ('ev1', 'STAY', 's1', 'CREATE', 'PENDING', '2024-01-01', '2024-01-01');`);
        sqlite.exec(`INSERT INTO attachments_outbox (id, entity_type, entity_id, field_name, local_path, remote_bucket, remote_path, status, created_at, updated_at) VALUES ('att1', 'STAY', 's1', 'entry_photo', 'local.jpg', 'bucket', 'remote.jpg', 'PENDING', '2024-01-01', '2024-01-01');`);
        
        // Ensure WAL is flushed/active if any
        sqlite.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);

        // 2. CREATE BACKUP
        const manager = SQLiteManager.getInstance();
        manager.createBackup(backupPath);

        expect(fs.existsSync(backupPath)).toBe(true);

        // 3. DESTROY ORIGINAL
        SQLiteManager.resetInstance();
        fs.renameSync(originalPath, corruptedPath);

        // 4. RESTORE DB FROM BACKUP
        fs.copyFileSync(backupPath, originalPath);

        // 5. VALIDATE RESTORE
        SQLiteManager.resetInstance();
        const restoredDb = SQLiteManager.initForTest(originalPath).getDatabase();

        const v = restoredDb.prepare('SELECT count(*) as c FROM vehicles').get() as any;
        expect(v.c).toBe(1);

        const o = restoredDb.prepare(`SELECT count(*) as c FROM outbox_events WHERE status='PENDING'`).get() as any;
        expect(o.c).toBe(1);

        const a = restoredDb.prepare(`SELECT count(*) as c FROM attachments_outbox WHERE status='PENDING'`).get() as any;
        expect(a.c).toBe(1);

        const version = restoredDb.prepare('PRAGMA user_version').get() as any;
        expect(version.user_version).toBe(4);

        const integrity = restoredDb.prepare('PRAGMA integrity_check').get() as any;
        expect(integrity.integrity_check).toBe('ok');
    });
});
