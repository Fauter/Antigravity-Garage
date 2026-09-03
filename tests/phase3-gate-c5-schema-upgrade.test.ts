import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { DOMAIN_TABLES, FRESH_SCHEMA } from '../src/infrastructure/database/sqlite/schema/index';

// Helper to manipulate the schema file without bringing up the whole GarageIA.exe
// Since SQLiteManager is a singleton, we use its applyMigrations internally.

const testDir = path.join(process.cwd(), '.data', 'test');
const TEST_DB_PATH = path.join(testDir, 'test_schema_upgrade.sqlite');

const resetDB = () => {
    SQLiteManager.resetInstance();
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    try { if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    try { if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch (e) {}
    try { if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch (e) {}
    SQLiteManager.initForTest(TEST_DB_PATH);
};

describe('PHASE 3 - GATE C.5: SCHEMA UPGRADE SAFETY', () => {

    beforeAll(() => {
        resetDB();
    });

    afterAll(() => {
        resetDB();
    });

    it('TEST 1: Fresh install', () => {
        resetDB();
        const manager = SQLiteManager.getInstance();
        const db = manager.getDatabase();
        
        const version = db.prepare('PRAGMA user_version').get() as any;
        expect(version.user_version).toBe(4);

        const cols = db.prepare("PRAGMA table_info(garages)").all() as any[];
        expect(cols.length).toBe(2);
        expect(cols.find(c => c.name === 'id')).toBeDefined();
        expect(cols.find(c => c.name === 'json_data')).toBeDefined();
        
        const outboxCols = db.prepare("PRAGMA table_info(outbox_events)").all();
        expect(outboxCols.length).toBeGreaterThan(5);
    });

    it('TEST 2 & 12: Repeated startup is idempotent', () => {
        resetDB();
        SQLiteManager.getInstance();
        SQLiteManager.resetInstance();
        
        const manager = SQLiteManager.initForTest(TEST_DB_PATH);
        const version = manager.getDatabase().prepare('PRAGMA user_version').get() as any;
        expect(version.user_version).toBe(4);
    });

    it('TEST 3 & 4 & 5-10: Upgrade populated SQLite V1 preserves everything', () => {
        SQLiteManager.resetInstance();
        if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
        
        const db = new DatabaseSync(TEST_DB_PATH);
        db.exec(`
            CREATE TABLE stays (_id TEXT PRIMARY KEY, id TEXT, garage_id TEXT, plate TEXT, json_data TEXT);
            INSERT INTO stays (_id, id, garage_id, plate, json_data) VALUES ('nedb1', 'uuid1', 'g1', 'ABC123', '{"amount_paid": 500}');
            
            CREATE TABLE outbox_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, entity_type TEXT, entity_id TEXT, operation TEXT, payload TEXT, status TEXT, attempts INTEGER DEFAULT 0, last_error_code TEXT, last_error TEXT, next_attempt_at TEXT, acked_at TEXT, created_at TEXT, updated_at TEXT);
            INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES ('evt1', 'Stay', 'uuid1', 'CREATE', 'PENDING', '2023', '2023');
            INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES ('evt2', 'Stay', 'uuid2', 'UPDATE', 'RETRY', '2023', '2023');
            INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES ('evt3', 'Stay', 'uuid3', 'DELETE', 'BLOCKED', '2023', '2023');
            INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES ('evt4', 'Stay', 'uuid4', 'CREATE', 'ACKED', '2023', '2023');

            CREATE TABLE sync_checkpoints (collection_name TEXT PRIMARY KEY, last_synced_at TEXT NOT NULL);
            INSERT INTO sync_checkpoints (collection_name, last_synced_at) VALUES ('stays', '2023');
            
            PRAGMA user_version = 1;
        `);
        for (const t of DOMAIN_TABLES) {
            if (t !== 'stays') db.exec(`CREATE TABLE ${t} (_id TEXT PRIMARY KEY, id TEXT, json_data TEXT);`);
        }
        db.close();

        const manager = SQLiteManager.initForTest(TEST_DB_PATH);
        const upgradedDb = manager.getDatabase();

        const version = upgradedDb.prepare('PRAGMA user_version').get() as any;
        expect(version.user_version).toBe(4);

        const stays = upgradedDb.prepare('SELECT * FROM stays').all() as any[];
        expect(stays.length).toBe(1);
        expect(stays[0].id).toBe('uuid1');
        
        const jsonData = JSON.parse(stays[0].json_data);
        expect(jsonData.amount_paid).toBe(500); 
        expect(jsonData.plate).toBeUndefined();       
        expect(jsonData._id).toBeUndefined();
        expect(jsonData.id).toBe('uuid1');

        const outbox = upgradedDb.prepare('SELECT status, count(*) as count FROM outbox_events GROUP BY status').all() as any[];
        const outboxMap = Object.fromEntries(outbox.map(r => [r.status, r.count]));
        expect(outboxMap['PENDING']).toBe(1);
        expect(outboxMap['RETRY']).toBe(1);
        expect(outboxMap['BLOCKED']).toBe(1);
        expect(outboxMap['ACKED']).toBe(1);

        const cp = upgradedDb.prepare('SELECT * FROM sync_checkpoints').all() as any[];
        expect(cp.length).toBe(1);
        expect(cp[0].collection_name).toBe('stays');
    });

    it('TEST 13 & 14: SQLITE marker fail safes', () => {
        SQLiteManager.resetInstance();
        fs.writeFileSync(TEST_DB_PATH, 'NOT A SQLITE DATABASE CORRUPTED DATA');
        
        let threw = false;
        try {
            SQLiteManager.initForTest(TEST_DB_PATH);
        } catch (e) {
            threw = true;
        }
        expect(threw).toBe(true);
    });

    it('PRAGMA Tests', () => {
        resetDB();
        const db = SQLiteManager.getInstance().getDatabase();
        
        const sync = db.prepare('PRAGMA synchronous').get() as any;
        expect(sync.synchronous).toBe(2); // Gate 11 & 12 requires FULL

        const wal = db.prepare('PRAGMA journal_mode').get() as any;
        expect(wal.journal_mode.toLowerCase()).toBe('wal');

        const fk = db.prepare('PRAGMA foreign_keys').get() as any;
        expect(fk.foreign_keys).toBe(1);
    });

});
