import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { syncService } from '../src/modules/Sync/application/SyncService';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { supabase as SupabaseClient } from '../src/infrastructure/lib/supabase';
import fs from 'fs';
import path from 'path';

describe('PHASE 3.1 - G: DISASTER RECOVERY', () => {
    const testDir = path.join(process.cwd(), '.data', 'test');
    const dbPath = path.join(testDir, 'test_disaster_recovery.sqlite');
    const corruptedPath = path.join(testDir, 'test_disaster_corrupted.sqlite');

    beforeAll(() => {
        process.env.TEST_DISASTER = '1';
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        vi.spyOn(SupabaseClient, 'from').mockImplementation((table: string) => {
            const builder = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                then: function (resolve: any) {
                    return resolve({
                        data: table === 'vehicles' ? [{
                            id: 'dr-veh-1',
                            garage_id: 'test-garage',
                            plate: 'DR123',
                            json_data: JSON.stringify({ plate: 'DR123' })
                        }] : [],
                        error: null
                    });
                }
            };
            return builder as any;
        });

        // Delete the DB to simulate disaster
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    });

    afterAll(() => {
        process.env.TEST_DISASTER = '';
        vi.restoreAllMocks();
        SQLiteManager.resetInstance();
    });

    it('G1: System aborts and SAFETY STOPS when SQLite is missing in SQLITE engine mode', async () => {
        // We set engine to SQLITE in beforeAll, and deleted the DB.
        // When we instantiate SqliteManager, it should throw SAFETY STOP!
        
        expect(() => {
            SQLiteManager.resetInstance();
            SQLiteManager.initForTest(dbPath).getDatabase();
        }).toThrow(/SAFETY STOP: Local database missing but engine is SQLITE/);
    });
});
