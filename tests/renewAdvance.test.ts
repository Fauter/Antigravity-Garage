import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';

describe('ADVANCE Flow Concurrency & Rollback', () => {
    let db: any;
    beforeEach(() => {
        db = SQLiteManager.initForTest().getDatabase();
        db.exec('CREATE TABLE IF NOT EXISTS test_advance (id INTEGER PRIMARY KEY, val TEXT)');
        db.exec('DELETE FROM test_advance');
    });

    afterEach(() => {
        SQLiteManager.resetInstance();
    });

    it('debe ejecutar un rollback exitoso si ocurre un error dentro de la transaccion', async () => {
        try {
            await TransactionHelper.runAsync(async (txDb) => {
                txDb.prepare('INSERT INTO test_advance (val) VALUES (?)').run('test');
                throw new Error('Simulated failure during advance');
            });
        } catch (e: any) {
            expect(e.message).toBe('Simulated failure during advance');
        }
        
        const count = db.prepare('SELECT count(*) as c FROM test_advance').get().c;
        expect(count).toBe(0); // Rollback debe haber ocurrido
    });

});
