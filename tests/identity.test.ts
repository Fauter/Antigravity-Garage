import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Canonical Identity (FASE 1)', () => {
    const testDbPath = '.data/garageia-test-identity.sqlite';

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        process.env.SQLITE_DB_PATH = testDbPath;
        const db = SQLiteManager.getInstance().getDatabase();
        
        db.prepare(`
            CREATE TABLE IF NOT EXISTS debts (id TEXT PRIMARY KEY, json_data TEXT)
        `).run();
        db.prepare(`
            CREATE TABLE IF NOT EXISTS outbox_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT, entity_type TEXT, entity_id TEXT, operation TEXT,
                payload TEXT, status TEXT, created_at TEXT, updated_at TEXT,
                attempts INTEGER DEFAULT 0, last_attempt_at TEXT, last_error TEXT,
                last_error_code TEXT, acked_at TEXT
            )
        `).run();
    });

    afterAll(() => {
        const db = SQLiteManager.getInstance().getDatabase();
        if (db && typeof db.close === 'function') db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('Repository should deduplicate dual physical rows and return a single canonical entity', async () => {
        const db = SQLiteManager.getInstance().getDatabase();
        const repo = new SqliteDebtRepository();
        
        const logicalId = uuidv4();
        
        // 1. Insert Legacy Row (NeDB PK, UUID logical ID)
        const legacyDebt = {
            id: logicalId,
            status: 'PENDING',
            amount: 860000,
            remaining_amount: 860000,
            type: 'CANON',
            dueDate: new Date().toISOString()
        };
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run('abc123legacy', JSON.stringify(legacyDebt));

        // 2. Insert Sync Row (UUID PK, UUID logical ID) - missing remaining_amount but marked PAID
        const syncDebt = {
            id: logicalId,
            status: 'PAID',
            amount: 860000,
            type: 'CANON',
            dueDate: new Date().toISOString()
        };
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run(logicalId, JSON.stringify(syncDebt));

        // 3. Test findAll
        const allDebts = await repo.findAll();
        const found = allDebts.filter(d => d.id === logicalId);
        
        expect(found.length).toBe(1);
        
        const canonical = found[0] as any;
        expect(canonical.id).toBe(logicalId);
        expect(canonical.status).toBe('PAID');
        expect(canonical.remaining_amount).toBe(0); // merged from PAID logic
        expect(canonical.amount_paid).toBe(860000); // merged from PAID logic

        // 4. Test findById (Should find the canonical row by UUID PK)
        const byId = await repo.findById(logicalId) as any;
        expect(byId).not.toBeNull();
        expect(byId.id).toBe(logicalId);
        
        // Check finding by subscription ID
        db.prepare(`DELETE FROM debts`).run();
        const subId = uuidv4();
        const debtId2 = uuidv4();
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run('leg1', JSON.stringify({id: debtId2, subscriptionId: subId, status: 'PENDING', remaining_amount: 100}));
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run(debtId2, JSON.stringify({id: debtId2, subscriptionId: subId, status: 'PAID'}));
        
        const bySub = await repo.findBySubscriptionId(subId);
        expect(bySub.length).toBe(1);
        expect(bySub[0].status).toBe('PAID');
        expect((bySub[0] as any).remaining_amount).toBe(0);
    });

    it('save() should not create a second physical row if a legacy row exists', async () => {
        const db = SQLiteManager.getInstance().getDatabase();
        const repo = new SqliteDebtRepository();
        
        const logicalId = uuidv4();
        db.prepare(`DELETE FROM debts`).run();

        // 1. Insert ONLY Legacy Row
        const legacyDebt = {
            id: logicalId,
            status: 'PENDING',
            amount: 500,
            remaining_amount: 500,
            type: 'CANON'
        };
        db.prepare(`INSERT INTO debts (id, json_data) VALUES (?, ?)`).run('legacyPK123', JSON.stringify(legacyDebt));

        // 2. Call save() with the UUID
        const updatedDebt = { ...legacyDebt, status: 'PAID', remaining_amount: 0, amount_paid: 500 };
        await repo.save(updatedDebt as any);

        // 3. Verify physical rows in DB
        const physicalRows = db.prepare(`SELECT id FROM debts WHERE json_extract(json_data, '$.id') = ?`).all(logicalId) as any[];
        
        expect(physicalRows.length).toBe(1);
        expect(physicalRows[0].id).toBe('legacyPK123'); // FASE 3 invariant: runtime jamás DELETE automático, legacy row is preserved.
    });
});
