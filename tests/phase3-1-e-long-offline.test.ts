import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { supabase as SupabaseClient } from '../src/infrastructure/lib/supabase';
import { VehicleRepository } from '../src/modules/Garage/infra/VehicleRepository';
import { v4 as uuidv4 } from 'uuid';

describe('PHASE 3.1 - E: LONG OFFLINE (GC SAFETY)', () => {
    let sqlite: any;
    let syncCoordinator: SqliteSyncCoordinator;
    let vehicleRepo: VehicleRepository;

    beforeAll(async () => {
        vi.useFakeTimers();

        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        vi.spyOn(SupabaseClient, 'rpc').mockRejectedValue(new Error('ENOTFOUND'));

        sqlite = SQLiteManager.getInstance().getDatabase();
        sqlite.exec('DELETE FROM outbox_events;');
        sqlite.exec('DELETE FROM vehicles;');

        vehicleRepo = new VehicleRepository();
        syncCoordinator = new SqliteSyncCoordinator();
        syncCoordinator.stopBackgroundSync?.();
        if ((syncCoordinator as any).syncInterval) {
            clearInterval((syncCoordinator as any).syncInterval);
        }
    });

    afterAll(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('E1: Events pending for 72+ hours should not be GCed and should drain when online', async () => {
        // Insert an event
        await vehicleRepo.save({
            id: uuidv4(),
            plate: 'LONG01',
            type: 'Auto',
            createdAt: new Date(),
            updatedAt: new Date()
        } as any);

        const initialPending = sqlite.prepare("SELECT COUNT(*) as c FROM outbox_events WHERE status = 'PENDING'").get().c;
        expect(initialPending).toBe(1);

        // Fail once
        await syncCoordinator.processOutbox();

        // Advance 7 days! GC deletes ACKED events older than 7 days.
        // We verify that RETRY/PENDING events are untouched.
        vi.setSystemTime(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));

        // Trigger SyncCoordinator which runs GC
        await syncCoordinator.processOutbox();

        const pendingOrRetry = sqlite.prepare("SELECT COUNT(*) as c FROM outbox_events WHERE status IN ('PENDING', 'RETRY')").get().c;
        expect(pendingOrRetry).toBe(1);

        // Now come back online
        vi.spyOn(SupabaseClient, 'rpc').mockResolvedValue({ data: { success: true }, error: null } as any);
        await syncCoordinator.processOutbox();

        const acked = sqlite.prepare("SELECT COUNT(*) as c FROM outbox_events WHERE status = 'ACKED'").get().c;
        expect(acked).toBe(1);
    });
});
