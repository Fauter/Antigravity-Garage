import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';

import path from 'path';
import fs from 'fs';

describe('PHASE 3.1 - H: OBSERVABILITY', () => {
    let sqlite: any;
    let syncCoordinator: SqliteSyncCoordinator;
    let testDbPath: string;

    beforeAll(() => {
        const testDir = path.join(process.cwd(), '.data', 'test');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        testDbPath = path.join(testDir, `test_observability_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);

        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        sqlite = SQLiteManager.initForTest(testDbPath).getDatabase();
        sqlite.exec('DELETE FROM outbox_events;');
        sqlite.exec('DELETE FROM attachments_outbox;');

        syncCoordinator = new SqliteSyncCoordinator();
        syncCoordinator.stopBackgroundSync?.();
        if ((syncCoordinator as any).syncInterval) {
            clearInterval((syncCoordinator as any).syncInterval);
        }
    });

    afterAll(() => {
        vi.restoreAllMocks();
        SQLiteManager.resetInstance();
        if (testDbPath && fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch {}
        }
    });

    it('H1: getStatus() returns detailed queues and errors for Technical Support', async () => {
        sqlite.exec(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES ('ev1', 'STAY', '1', 'CREATE', 'RETRY', '2023-01-01', '2023-01-01');`);
        sqlite.exec(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, status, created_at, updated_at) VALUES ('ev2', 'STAY', '2', 'CREATE', 'BLOCKED', '2023-01-01', '2023-01-01');`);
        
        sqlite.exec(`INSERT INTO attachments_outbox (id, entity_type, entity_id, field_name, local_path, remote_bucket, remote_path, status) VALUES ('att1', 'STAY', '1', 'p', 'p', 'b', 'r', 'RETRY');`);
        sqlite.exec(`INSERT INTO attachments_outbox (id, entity_type, entity_id, field_name, local_path, remote_bucket, remote_path, status) VALUES ('att2', 'STAY', '2', 'p', 'p', 'b', 'r', 'FAILED');`);

        const status = await syncCoordinator.getStatus();

        expect(status.retry).toBe(1);
        expect(status.blocked).toBe(1);
        expect(status.attachmentsPending).toBe(1);
        expect(status.attachmentsFailed).toBe(1);
    });
});
