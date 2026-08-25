import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';

const TEST_DB_PATH = path.join(process.cwd(), '.data', 'garageia.sqlite');
const MARKER_PATH = path.join(process.cwd(), '.data', 'storage-engine.json');

const resetDB = () => {
    SQLiteManager.resetInstance();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
    if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');
};

describe('PHASE 3 - GATE D: POWER LOSS & ATOMICITY', () => {
    beforeAll(() => {
        fs.writeFileSync(MARKER_PATH, JSON.stringify({ engine: 'SQLITE' }));
    });

    afterAll(() => {
        resetDB();
    });

    it('TEST 1: Domain + Outbox atomicity on application error (Rollback)', () => {
        resetDB();
        const manager = SQLiteManager.getInstance();
        const db = manager.getDatabase();

        // Ensure clean state
        const initialCount = (db.prepare('SELECT count(*) as c FROM stays').get() as any).c;
        const initialOutbox = (db.prepare('SELECT count(*) as c FROM outbox_events').get() as any).c;
        expect(initialCount).toBe(0);
        expect(initialOutbox).toBe(0);

        // Attempt a dual-write that FAILS midway
        let threw = false;
        try {
            TransactionHelper.run((tx) => {
                // 1. Insert domain data successfully
                tx.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run('stay-1', '{"plate": "FAIL01"}');
                
                // 2. Simulate logic error or power loss right before outbox insert
                throw new Error('SIMULATED_POWER_LOSS');
                
                tx.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('evt-1', 'Stay', 'stay-1', 'CREATE', 'PENDING', '2023', '2023');
            });
        } catch (e: any) {
            if (e.message === 'SIMULATED_POWER_LOSS') threw = true;
        }

        expect(threw).toBe(true);

        // Verify NO DATA was written (Atomic Rollback)
        const finalCount = (db.prepare('SELECT count(*) as c FROM stays').get() as any).c;
        const finalOutbox = (db.prepare('SELECT count(*) as c FROM outbox_events').get() as any).c;
        
        expect(finalCount).toBe(0); // Should be rolled back
        expect(finalOutbox).toBe(0);
    });

    it('TEST 2: Domain + Outbox atomicity on constraints violation', () => {
        resetDB();
        const db = SQLiteManager.getInstance().getDatabase();

        TransactionHelper.run((tx) => {
            tx.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run('stay-1', '{"plate": "OK"}');
            tx.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('evt-1', 'Stay', 'stay-1', 'CREATE', 'PENDING', '2023', '2023');
        });

        // Try to insert a second event with the SAME EVENT ID (UNIQUE constraint violation)
        let threw = false;
        try {
            TransactionHelper.run((tx) => {
                tx.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run('stay-2', '{"plate": "FAIL"}');
                // This violates UNIQUE event_id
                tx.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('evt-1', 'Stay', 'stay-2', 'CREATE', 'PENDING', '2023', '2023');
            });
        } catch (e: any) {
            threw = true;
        }

        expect(threw).toBe(true);

        // Verify stay-2 was NOT created because outbox failed
        const stays = db.prepare('SELECT * FROM stays').all() as any[];
        expect(stays.length).toBe(1);
        expect(stays[0].id).toBe('stay-1'); // Only stay-1 exists

        const outbox = db.prepare('SELECT * FROM outbox_events').all() as any[];
        expect(outbox.length).toBe(1);
    });

});
