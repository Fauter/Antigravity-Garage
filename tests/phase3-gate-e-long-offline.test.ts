import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';

const testDbDir = path.join(process.cwd(), '.data', 'test');
let testDbPath: string;

const resetDB = () => {
    SQLiteManager.resetInstance();
    if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });
    testDbPath = path.join(testDbDir, `test_long_offline_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);
    SQLiteManager.initForTest(testDbPath);
};

describe('PHASE 3 - GATE E: LONG OFFLINE', () => {
    beforeAll(() => {
        resetDB();
    });

    afterAll(() => {
        SQLiteManager.resetInstance();
        if (testDbPath && fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch {}
        }
    });

    it('TEST 1: Massive accumulation of PENDING events does not degrade reads', () => {
        resetDB();
        const db = SQLiteManager.getInstance().getDatabase();

        // 1. Insert 10,000 stays (representing 30 days offline)
        TransactionHelper.run((tx) => {
            const insertStay = tx.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`);
            const insertOutbox = tx.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            
            for (let i = 0; i < 5000; i++) {
                insertStay.run(`stay-${i}`, `{"plate": "ABC${i}"}`);
                insertOutbox.run(`evt-${i}`, 'Stay', `stay-${i}`, 'CREATE', 'PENDING', new Date().toISOString(), new Date().toISOString());
            }
        });

        // 2. Read query should still be instant (tested by vitest timeout)
        const t0 = performance.now();
        const stays = db.prepare('SELECT * FROM stays LIMIT 100').all() as any[];
        const t1 = performance.now();
        
        expect(stays.length).toBe(100);
        expect(t1 - t0).toBeLessThan(100); // Should be very fast (under 100ms)

        // 3. Count outbox pending
        const pendingCount = (db.prepare('SELECT count(*) as c FROM outbox_events WHERE status = ?').get('PENDING') as any).c;
        expect(pendingCount).toBe(5000);
    });

    it('TEST 2: Checkpoint writes are blazing fast despite WAL size', () => {
        const db = SQLiteManager.getInstance().getDatabase();
        
        const t0 = performance.now();
        db.prepare('INSERT OR REPLACE INTO sync_checkpoints (collection_name, last_synced_at) VALUES (?, ?)').run('stays', new Date().toISOString());
        const t1 = performance.now();
        
        expect(t1 - t0).toBeLessThan(50); // Under 50ms
    });

});
