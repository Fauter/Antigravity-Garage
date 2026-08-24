import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { syncService } from '../src/modules/Sync/application/SyncService';
import { StayRepository } from '../src/modules/AccessControl/infra/StayRepository';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../src/infrastructure/database/datastore';

describe('GATE C & D - Outbox Worker', () => {

    beforeAll(() => {
        StorageEngine.setEngine('SQLITE');
        SQLiteManager.resetInstance();
    });

    afterAll(() => {
        StorageEngine.setEngine('NEDB');
        SQLiteManager.resetInstance();
        try { fs.unlinkSync(path.join(DATA_DIR, 'garageia.sqlite')); } catch (e) {}
    });

    it('TEST C1: outbox_events reflect correctly the proxy output', async () => {
        const repo = new StayRepository();
        await repo.save({ plate: 'TEST-OBOX', entryTime: new Date() } as any);
        
        const db = SQLiteManager.getInstance().getDatabase();
        const pending = db.prepare(`SELECT count(*) as c FROM outbox_events WHERE status = 'PENDING'`).get() as any;
        expect(pending.c).toBeGreaterThan(0);
    });

    it('TEST D1: SyncCoordinator is routed correctly', async () => {
        const status = await syncService.getStatus();
        // The SQLite sync coordinator uses different metrics than NeDB
        expect(status).toHaveProperty('state');
        expect(status).toHaveProperty('pending');
        expect(status.state).toBeDefined();
    });
});
