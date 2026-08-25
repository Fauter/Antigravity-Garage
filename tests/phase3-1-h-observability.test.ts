import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';

describe('PHASE 3.1 - H: OBSERVABILITY', () => {
    let sqlite: any;
    let syncCoordinator: SqliteSyncCoordinator;

    beforeAll(() => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        sqlite = SQLiteManager.getInstance().getDatabase();
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
