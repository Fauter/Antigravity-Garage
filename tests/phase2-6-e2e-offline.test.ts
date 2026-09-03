import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { StayRepository } from '../src/modules/AccessControl/infra/StayRepository';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { supabase } from '../src/infrastructure/lib/supabase.js';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../src/infrastructure/database/datastore';

describe('PHASE 2.6 - End-to-End Offline Proof', () => {

    let originalFrom: any;
    let testDbPath: string;

    beforeAll(() => {
        const testDir = path.join(DATA_DIR, 'test');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        testDbPath = path.join(testDir, `test_e2e_offline_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);
        StorageEngine.setEngine('SQLITE');
        SQLiteManager.initForTest(testDbPath);

        // MOCK SUPABASE TO BE INACCESSIBLE (GLOBAL CONNECTIVITY FAILURE)
        originalFrom = supabase.from;
        (supabase as any).from = vi.fn().mockReturnValue({
            upsert: vi.fn().mockRejectedValue(new Error('ENOTFOUND: supabase.co is unreachable')),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockRejectedValue(new Error('ENOTFOUND: supabase.co is unreachable')) }),
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockRejectedValue(new Error('ENOTFOUND: supabase.co is unreachable')) })
        });
    });

    afterAll(() => {
        StorageEngine.setEngine('NEDB');
        SQLiteManager.resetInstance();
        (supabase as any).from = originalFrom;
        vi.restoreAllMocks();
        if (testDbPath && fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch (e) {}
        }
    });

    it('TEST 18: End-to-End Offline Real - API Success while Backend Offline', async () => {
        const repo = new StayRepository();
        const syncWorker = new SqliteSyncCoordinator();
        
        // SIMULAR QUE LA API LLAMA AL REPOSITORIO (ESTAMOS OFFLINE)
        const stay = { plate: 'OFF-100', entryTime: new Date() } as any;
        
        const saved = await repo.save(stay);
        
        // 1. HTTP/Domain API SUCCEEDED
        expect(saved.id).toBeDefined();
        
        // 2. Domain SQLite Row Exists
        const db = SQLiteManager.getInstance().getDatabase();
        const row = db.prepare(`SELECT * FROM stays WHERE id = ?`).get(saved.id) as any;
        expect(row).toBeDefined();
        
        // 3. Outbox PENDING exists
        const outboxEvent = db.prepare(`SELECT * FROM outbox_events WHERE entity_id = ? AND entity_type = 'Stay' AND operation = 'CREATE'`).get(saved.id) as any;
        expect(outboxEvent).toBeDefined();
        expect(outboxEvent.status).toBe('PENDING');

        // 4. Worker intenta procesar y falla (Network error)
        await syncWorker.processOutbox();
        
        // 5. Worker debe dejarlo en RETRY y NO EN BLOCKED. 
        const updatedEvent = db.prepare(`SELECT * FROM outbox_events WHERE sequence = ?`).get(outboxEvent.sequence) as any;
        expect(updatedEvent.status).toBe('RETRY');
        expect(updatedEvent.attempts).toBe(1);
    });
    
    it('TEST 19 & 20: Restart Offline & Continued Operation', async () => {
        // SIMULATE APP RESTART
        SQLiteManager.resetInstance();
        SQLiteManager.initForTest(testDbPath);
        
        const db = SQLiteManager.getInstance().getDatabase();
        
        // 1. DOMAIN PERSISTS
        const row = db.prepare(`SELECT * FROM stays WHERE json_extract(json_data, '$.plate') = ?`).get('OFF-100') as any;
        expect(row).toBeDefined();
        
        // 2. OUTBOX PERSISTS
        const outboxEvent = db.prepare(`SELECT * FROM outbox_events WHERE entity_id = ?`).get(JSON.parse(row.json_data).id) as any;
        expect(outboxEvent.status).toBe('RETRY');
        
        // 3. CONTINUED OPERATION (New write while still offline)
        const repo = new StayRepository();
        const stay2 = { plate: 'OFF-101', entryTime: new Date() } as any;
        const saved2 = await repo.save(stay2);
        
        expect(saved2.id).toBeDefined();
        
        const outboxEvent2 = db.prepare(`SELECT * FROM outbox_events WHERE entity_id = ?`).get(saved2.id) as any;
        expect(outboxEvent2.status).toBe('PENDING');
    });

    it('TEST 21: Auto-Reconnect Convergence', async () => {
        // SIMULATE RECONNECTION (Supabase returns online)
        let upsertCalls = 0;
        (supabase as any).from = vi.fn().mockReturnValue({
            upsert: vi.fn().mockImplementation(() => {
                upsertCalls++;
                return Promise.resolve({ error: null, data: 'success' });
            })
        });

        const syncWorker = new SqliteSyncCoordinator();
        await syncWorker.processOutbox();

        const db = SQLiteManager.getInstance().getDatabase();
        
        // Assert Both Events were processed and became ACKED
        const events = db.prepare(`SELECT * FROM outbox_events WHERE status = 'ACKED'`).all();
        expect(events.length).toBe(2);
        expect(upsertCalls).toBe(2);
    });
});
