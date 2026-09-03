import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { supabase as SupabaseClient } from '../src/infrastructure/lib/supabase';
import { VehicleRepository } from '../src/modules/Garage/infra/VehicleRepository';
import { CustomerRepository } from '../src/modules/Garage/infra/CustomerRepository';
import { v4 as uuidv4 } from 'uuid';

describe('PHASE 3.1 - B: REALISTIC OFFLINE BACKLOG & DRAIN', () => {
    let sqlite: any;
    let syncCoordinator: SqliteSyncCoordinator;
    let vehicleRepo: VehicleRepository;
    let customerRepo: CustomerRepository;
    let testDbPath: string;

    beforeAll(async () => {
        vi.useFakeTimers();

        const testDir = path.join(process.cwd(), '.data', 'test');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        testDbPath = path.join(testDir, `test_backlog_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);

        // 1. Force SQLite Engine & Offline mode
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        // Mock Supabase to be completely OFFLINE
        (SupabaseClient as any).from = vi.fn().mockReturnValue({
            upsert: vi.fn().mockRejectedValue(new Error('ENOTFOUND: supabase.co is unreachable')),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockRejectedValue(new Error('ENOTFOUND: supabase.co is unreachable')) })
        });

        // 2. Initialize Fresh Database
        sqlite = SQLiteManager.initForTest(testDbPath).getDatabase();
        // Clear outbox for this test
        sqlite.exec('DELETE FROM outbox_events;');
        sqlite.exec('DELETE FROM vehicles;');
        sqlite.exec('DELETE FROM customers;');

        vehicleRepo = new VehicleRepository();
        customerRepo = new CustomerRepository();
        syncCoordinator = new SqliteSyncCoordinator();
    });

    afterAll(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        SQLiteManager.resetInstance();
        if (testDbPath && fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch {}
        }
    });

    it('B1: Should accumulate 300 mixed realistic operations offline', async () => {
        // We will do 100 customers, 100 vehicles, and 100 updates.
        // Total = 300 operations.
        
        for (let i = 0; i < 100; i++) {
            const customerId = uuidv4();
            const vehicleId = uuidv4();
            
            // 1. Create Customer
            await customerRepo.save({
                id: customerId,
                name: `Test Customer ${i}`,
                dni: `DNI-${i}`,
                createdAt: new Date(),
                updatedAt: new Date()
            } as any);

            // 2. Create Vehicle
            await vehicleRepo.save({
                id: vehicleId,
                plate: `SIM${i.toString().padStart(3, '0')}`,
                type: 'Auto',
                customerId: customerId,
                createdAt: new Date(),
                updatedAt: new Date()
            } as any);

            // 3. Update Vehicle
            await vehicleRepo.save({
                id: vehicleId,
                plate: `SIM${i.toString().padStart(3, '0')}`,
                type: 'Moto', // change type
                customerId: customerId,
                createdAt: new Date(),
                updatedAt: new Date()
            } as any);
        }

        const outboxCount = sqlite.prepare('SELECT COUNT(*) as c FROM outbox_events WHERE status = ?').get('PENDING').c;
        expect(outboxCount).toBe(300);
    });

    it('B2: Multiple Offline Restarts should preserve exact backlog integrity', async () => {
        // Take a snapshot of current outbox
        const snapshot1 = sqlite.prepare('SELECT * FROM outbox_events ORDER BY created_at ASC').all();
        
        // Restart 1
        SQLiteManager.resetInstance();
        sqlite = SQLiteManager.initForTest(testDbPath).getDatabase();
        
        // Restart 2
        SQLiteManager.resetInstance();
        sqlite = SQLiteManager.initForTest(testDbPath).getDatabase();

        const snapshot2 = sqlite.prepare('SELECT * FROM outbox_events ORDER BY created_at ASC').all();
        
        expect(snapshot2.length).toBe(snapshot1.length);
        for (let i = 0; i < snapshot1.length; i++) {
            expect(snapshot2[i].event_id).toBe(snapshot1[i].event_id);
            expect(snapshot2[i].payload).toBe(snapshot1[i].payload);
            expect(snapshot2[i].status).toBe(snapshot1[i].status);
        }
    });

    it('B3: Long Offline should not transition events to BLOCKED falsely', async () => {
        // Stop interval to prevent 25,000 executions when advancing time
        syncCoordinator.stopBackgroundSync?.();
        if ((syncCoordinator as any).syncInterval) {
            clearInterval((syncCoordinator as any).syncInterval);
        }

        // Trigger sync attempt which will fail because we are offline
        await syncCoordinator.processOutbox();
        
        // Advance time by 72 hours
        vi.setSystemTime(new Date(Date.now() + 72 * 60 * 60 * 1000));
        
        // Trigger another sync
        await syncCoordinator.processOutbox();

        const statusCounts = sqlite.prepare('SELECT status, COUNT(*) as c FROM outbox_events GROUP BY status').all();
        
        const blocked = statusCounts.find((s: any) => s.status === 'BLOCKED')?.c || 0;
        const pending = statusCounts.find((s: any) => s.status === 'PENDING')?.c || 0;
        const retry = statusCounts.find((s: any) => s.status === 'RETRY')?.c || 0;

        console.log('Status Counts:', statusCounts);
        expect(blocked).toBe(0); // Network failure must never cause BLOCKED
        expect(pending + retry).toBe(300);
    });

    it('B4 & B5: Automatic Reconnect and Complete Drain', async () => {
        // 1. Reconnect Network
        (SupabaseClient as any).from = vi.fn().mockReturnValue({
            upsert: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: { success: true }, error: null }) })
        });

        // 2. Trigger automatic reconnect repeatedly until drained
        while (true) {
            const pending = sqlite.prepare("SELECT COUNT(*) as c FROM outbox_events WHERE status IN ('PENDING', 'RETRY')").get().c;
            if (pending === 0) break;
            await syncCoordinator.processOutbox();
        }

        // 3. Verify Complete Drain
        const pending = sqlite.prepare("SELECT COUNT(*) as c FROM outbox_events WHERE status IN ('PENDING', 'RETRY')").get().c;
        const acked = sqlite.prepare("SELECT COUNT(*) as c FROM outbox_events WHERE status = 'ACKED'").get().c;

        expect(pending).toBe(0);
        expect(acked).toBe(300);
    });
});
