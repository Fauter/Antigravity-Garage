import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ShiftCloseRepository } from '../src/modules/Garage/infra/ShiftCloseRepository.js';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine.js';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager.js';

describe('ShiftCloseRepository SQLite', () => {
    beforeAll(async () => {
        // Force SQLITE
        StorageEngine.getEngine = () => 'SQLITE'; 
        
        const db = SQLiteManager.getInstance().getDatabase();
        
        // Clean table
        db.prepare('DELETE FROM shift_closes').run();
        
        // Insert record
        const repo = new ShiftCloseRepository();
        await repo.save({
            id: 'S2',
            garageId: 'G1',
            operator: 'WALTER',
            staying_in_cash: 434392,
            timestamp: new Date().toISOString()
        });
    });

    it('should find S2 via findAll in SQLite mode', async () => {
        const repo = new ShiftCloseRepository();
        const results = await repo.findAll();
        expect(results.length).toBeGreaterThan(0);
        expect(results.find((r: any) => r.id === 'S2')).toBeDefined();
    });
});
