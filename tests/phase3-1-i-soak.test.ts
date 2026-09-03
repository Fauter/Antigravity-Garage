import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { VehicleRepository } from '../src/modules/Garage/infra/VehicleRepository';
import { v4 as uuidv4 } from 'uuid';

import path from 'path';
import fs from 'fs';

describe('PHASE 3.1 - I: SOAK / WAL PERFORMANCE', () => {
    let sqlite: any;
    let repo: VehicleRepository;
    let testDbPath: string;

    beforeAll(() => {
        const testDir = path.join(process.cwd(), '.data', 'test');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        testDbPath = path.join(testDir, `test_soak_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);

        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        sqlite = SQLiteManager.initForTest(testDbPath).getDatabase();
        sqlite.exec('DELETE FROM vehicles;');
        sqlite.exec('DELETE FROM outbox_events;');
        repo = new VehicleRepository();
    });

    afterAll(() => {
        vi.restoreAllMocks();
        SQLiteManager.resetInstance();
        if (testDbPath && fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch {}
        }
    });

    it('I1: Should handle 1000 concurrent inserts without SQLITE_BUSY (WAL/NORMAL Mode)', async () => {
        const pragmaWal = sqlite.prepare('PRAGMA journal_mode;').get();
        expect(pragmaWal.journal_mode.toUpperCase()).toBe('WAL');

        const NUM_INSERTS = 1000;
        const promises = [];

        for (let i = 0; i < NUM_INSERTS; i++) {
            promises.push(
                repo.save({
                    id: uuidv4(),
                    plate: `WAL${i}`,
                    type: 'Auto',
                    createdAt: new Date(),
                    updatedAt: new Date()
                } as any)
            );
        }

        // Wait for all concurrent inserts
        await Promise.all(promises);

        // Verify all 1000 were inserted correctly
        const count = sqlite.prepare('SELECT COUNT(*) as c FROM vehicles').get().c;
        expect(count).toBe(1000);
        
        const outboxCount = sqlite.prepare('SELECT COUNT(*) as c FROM outbox_events').get().c;
        expect(outboxCount).toBe(1000);
    }, 20000); // Allow up to 20 seconds
});
