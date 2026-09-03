import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
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
    let testDbPath: string;

    beforeAll(async () => {
        vi.useFakeTimers();

        const testDir = path.join(process.cwd(), '.data', 'test');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        testDbPath = path.join(testDir, `test_gc_safety_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);

        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        (SupabaseClient as any).from = vi.fn().mockReturnValue({
            upsert: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockRejectedValue(new Error('ENOTFOUND')) })
        });

        sqlite = SQLiteManager.initForTest(testDbPath).getDatabase();
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
        SQLiteManager.resetInstance();
        if (testDbPath && fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch {}
        }
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
        (SupabaseClient as any).from = vi.fn().mockReturnValue({
            upsert: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: { success: true }, error: null }) })
        });
        await syncCoordinator.processOutbox();

        const acked = sqlite.prepare("SELECT COUNT(*) as c FROM outbox_events WHERE status = 'ACKED'").get().c;
        expect(acked).toBe(1);
    });
});
