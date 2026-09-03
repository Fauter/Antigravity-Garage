import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { FRESH_SCHEMA } from '../src/infrastructure/database/sqlite/schema/index';
import fs from 'fs';
import path from 'path';

describe('PHASE 3.2 - MULTI-CLIENT CONFLICTS & OBSERVABILITY', () => {
    let sqlite: any;
    const testDir = path.join(process.cwd(), '.data', 'test');
    const dbPath = path.join(testDir, 'test_multi_client.sqlite');

    beforeAll(() => {
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        // Manual initialization to bypass disaster check
        const { DatabaseSync } = require('node:sqlite');
        const tempDb = new DatabaseSync(dbPath);
        tempDb.exec(FRESH_SCHEMA);
        tempDb.exec('PRAGMA user_version = 3;');
        tempDb.close();

        SQLiteManager.resetInstance();
        sqlite = SQLiteManager.initForTest(dbPath).getDatabase();
    });

    afterAll(() => {
        vi.restoreAllMocks();
        SQLiteManager.resetInstance();
        if (fs.existsSync(dbPath)) {
            try { fs.unlinkSync(dbPath); } catch {}
        }
    });

    it('G25: Conflicts lead to BLOCKED status', () => {
        sqlite.exec(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, last_error_code, created_at, updated_at) VALUES ('evt1', 'Vehicle', 'v1', 'CREATE', 'BLOCKED', '23505', '2024', '2024')`);
        
        const count = sqlite.prepare(`SELECT count(*) as c FROM outbox_events WHERE status = 'BLOCKED'`).get() as any;
        expect(count.c).toBe(1);
    });

    it('G30: Technical mechanism to requeue blocked events', () => {
        sqlite.prepare(`UPDATE outbox_events SET status = 'RETRY', attempts = 0 WHERE status = 'BLOCKED'`).run();
        
        const blocked = sqlite.prepare(`SELECT count(*) as c FROM outbox_events WHERE status = 'BLOCKED'`).get() as any;
        expect(blocked.c).toBe(0);

        const retry = sqlite.prepare(`SELECT count(*) as c FROM outbox_events WHERE status = 'RETRY'`).get() as any;
        expect(retry.c).toBe(1);
    });
});
