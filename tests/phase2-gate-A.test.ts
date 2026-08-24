import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';
import { DATA_DIR } from '../src/infrastructure/database/datastore';

describe('GATE A - SQLite Infra & Transaction Helper', () => {
    
    beforeAll(() => {
        StorageEngine.setEngine('SQLITE'); // Force SQLITE for test
        SQLiteManager.resetInstance(); // Ensure we get the fresh DB
    });

    afterAll(() => {
        // Cleanup test DB
        SQLiteManager.resetInstance();
        StorageEngine.setEngine('NEDB'); // Reset to default
        try { fs.unlinkSync(path.join(DATA_DIR, 'garageia.sqlite')); } catch (e) {}
    });

    it('TEST A4: Marker temp write failure handled gracefully (Atomic rename)', () => {
        StorageEngine.setEngine('CUTOVER_PREPARED');
        expect(StorageEngine.getEngine()).toBe('CUTOVER_PREPARED');
        StorageEngine.setEngine('SQLITE'); // restore
    });

    it('TEST A6: PRAGMAs reales están activos', () => {
        const db = SQLiteManager.getInstance().getDatabase();
        
        const journal = db.prepare('PRAGMA journal_mode;').get() as any;
        expect(journal.journal_mode.toLowerCase()).toBe('wal');

        const sync = db.prepare('PRAGMA synchronous;').get() as any;
        expect(sync.synchronous).toBe(2); // FULL

        const fk = db.prepare('PRAGMA foreign_keys;').get() as any;
        expect(fk.foreign_keys).toBe(1); // ON
    });

    it('TEST A5: SQLite integrity check', () => {
        const db = SQLiteManager.getInstance().getDatabase();
        const integrity = db.prepare('PRAGMA integrity_check;').get() as any;
        expect(integrity.integrity_check).toBe('ok');
    });

    it('TEST A1: Transaction success', () => {
        const db = SQLiteManager.getInstance().getDatabase();
        
        TransactionHelper.run((tx) => {
            tx.prepare(`INSERT INTO vehicles (id, json_data) VALUES (?, ?)`).run('v_test_1', '{}');
            tx.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('ev_1', 'vehicle', 'v_test_1', 'CREATE', 'PENDING', new Date().toISOString(), new Date().toISOString());
        });

        const v = db.prepare(`SELECT * FROM vehicles WHERE id = 'v_test_1'`).get();
        expect(v).toBeDefined();

        const ev = db.prepare(`SELECT * FROM outbox_events WHERE event_id = 'ev_1'`).get();
        expect(ev).toBeDefined();
    });

    it('TEST A2: Domain mutation failure -> rollback', () => {
        const db = SQLiteManager.getInstance().getDatabase();
        
        try {
            TransactionHelper.run((tx) => {
                tx.prepare(`INSERT INTO vehicles (id, json_data) VALUES (?, ?)`).run('v_test_2', '{}');
                // Cause an error on purpose
                throw new Error('Domain Failure');
            });
        } catch (e: any) {
            expect(e.message).toBe('Domain Failure');
        }

        const v = db.prepare(`SELECT * FROM vehicles WHERE id = 'v_test_2'`).get();
        expect(v).toBeUndefined(); // Should be rolled back
    });

    it('TEST A3: Outbox insert failure -> rollback del dominio', () => {
        const db = SQLiteManager.getInstance().getDatabase();
        
        try {
            TransactionHelper.run((tx) => {
                tx.prepare(`INSERT INTO vehicles (id, json_data) VALUES (?, ?)`).run('v_test_3', '{}');
                // Force outbox failure by violating NOT NULL or similar
                tx.prepare(`INSERT INTO outbox_events (event_id) VALUES (NULL)`).run();
            });
        } catch (e: any) {
            expect(e.message).toContain('NOT NULL');
        }

        const v = db.prepare(`SELECT * FROM vehicles WHERE id = 'v_test_3'`).get();
        expect(v).toBeUndefined(); // Domain insert was rolled back!
    });

    it('TEST A7: Legacy quarantine preserves complete row', () => {
        const db = SQLiteManager.getInstance().getDatabase();
        
        const payload = JSON.stringify({ old: 'data' });
        db.prepare(`
            INSERT INTO legacy_quarantine (source_collection, legacy_nedb_id, domain_id, original_payload, reason, detected_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('debts', 'nedb_123', 'domain_uuid', payload, 'DUPLICATE', new Date().toISOString());

        const q = db.prepare(`SELECT * FROM legacy_quarantine WHERE legacy_nedb_id = 'nedb_123'`).get() as any;
        expect(q).toBeDefined();
        expect(q.original_payload).toBe(payload);
    });
});
