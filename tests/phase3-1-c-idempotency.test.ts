import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { supabase as SupabaseClient } from '../src/infrastructure/lib/supabase';
import { VehicleRepository } from '../src/modules/Garage/infra/VehicleRepository';
import { v4 as uuidv4 } from 'uuid';

describe('PHASE 3.1 - C: ACK LOST & REMOTE IDEMPOTENCY', () => {
    let sqlite: any;
    let syncCoordinator: SqliteSyncCoordinator;
    let vehicleRepo: VehicleRepository;
    let testDbPath: string;

    beforeAll(async () => {
        vi.useFakeTimers();

        const testDir = path.join(process.cwd(), '.data', 'test');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        testDbPath = path.join(testDir, `test_idempotency_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);

        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        sqlite = SQLiteManager.initForTest(testDbPath).getDatabase();
        sqlite.exec('DELETE FROM outbox_events;');
        sqlite.exec('DELETE FROM vehicles;');

        vehicleRepo = new VehicleRepository();
        syncCoordinator = new SqliteSyncCoordinator();
        
        // Disable automatic background sync for controlled testing
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

    it('C1: SyncCoordinator must retry if the network drops before ACK (ACK Lost)', async () => {
        const vehicleId = uuidv4();
        await vehicleRepo.save({
            id: vehicleId,
            plate: 'ACK001',
            type: 'Auto',
            createdAt: new Date(),
            updatedAt: new Date()
        } as any);

        const pending = sqlite.prepare("SELECT * FROM outbox_events WHERE status = 'PENDING'").all();
        expect(pending.length).toBe(1);
        const eventSequence = pending[0].sequence;

        // Mock: First call fails simulating a network timeout AFTER the server processed it.
        // Second call succeeds.
        let callCount = 0;
        (SupabaseClient as any).from = vi.fn().mockReturnValue({
            upsert: vi.fn().mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    // Simulate ACK lost (Timeout)
                    throw new Error('ETIMEDOUT: Connection lost before receiving ACK');
                }
                return { data: { success: true }, error: null };
            })
        });

        // 1st Attempt -> Should fail and move to RETRY
        await syncCoordinator.processOutbox();

        const afterFirst = sqlite.prepare("SELECT * FROM outbox_events WHERE sequence = ?").get(eventSequence);
        expect(afterFirst.status).toBe('RETRY');
        expect(afterFirst.attempts).toBe(1);

        // 2nd Attempt -> Should succeed and move to ACKED
        // Idempotency relies on Supabase accepting the retry seamlessly. We verify local state properly handles the retry.
        await syncCoordinator.processOutbox();

        const afterSecond = sqlite.prepare("SELECT * FROM outbox_events WHERE sequence = ?").get(eventSequence);
        expect(afterSecond.status).toBe('ACKED');
        expect(afterSecond.attempts).toBe(1); // Attempts counter isn't incremented on success, it remains what it was
        expect(callCount).toBe(2);
    });
});
