import { CorrelativeService } from '../src/shared/CorrelativeService';
import { supabase } from '../src/infrastructure/lib/supabase';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';
import { describe, it, expect, vi } from 'vitest';

describe('P0.3B Critical Locking Test', () => {
    it('should not block SQLite while waiting for RPC', async () => {
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec(`
            CREATE TABLE IF NOT EXISTS test_lock (id INTEGER PRIMARY KEY, msg TEXT);
            DELETE FROM test_lock;
            DROP TABLE IF EXISTS correlative_leases;
            CREATE TABLE correlative_leases (
                garage_id TEXT NOT NULL,
                type TEXT NOT NULL,
                active_start INTEGER NOT NULL DEFAULT 0,
                active_end INTEGER NOT NULL DEFAULT 0,
                last_issued INTEGER NOT NULL DEFAULT 0,
                reserve_start INTEGER NOT NULL DEFAULT 0,
                reserve_end INTEGER NOT NULL DEFAULT 0,
                active_request_id TEXT,
                reserve_request_id TEXT,
                pending_request_id TEXT,
                PRIMARY KEY (garage_id, type)
            );
        `);

        const garageId = '11111111-1111-4111-8111-111111111111';
        db.exec('DELETE FROM correlative_leases WHERE garage_id = ?', [garageId]);

        // Mock Supabase to delay 2 seconds
        vi.spyOn(supabase, 'rpc').mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 2000));
            return { data: [{ start_val: 1, end_val: 50 }], error: null } as any;
        });

        // Fire ensureStayLeaseAvailable
        const ensurePromise = CorrelativeService.ensureStayLeaseAvailable(garageId);

        // Wait 200ms to ensure it's "stuck" in the mock RPC
        await new Promise(r => setTimeout(r, 200));

        let writeSuccess = false;
        try {
            await TransactionHelper.runAsync(async (tx) => {
                db.prepare('INSERT INTO test_lock (msg) VALUES (?)').run('Concurrencia OK');
            });
            writeSuccess = true;
        } catch (e) {
            console.error(e);
        }

        expect(writeSuccess).toBe(true);

        try { await ensurePromise; } catch (e) {}
    });
});
