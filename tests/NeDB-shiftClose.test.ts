import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/infrastructure/database/datastore.js';
import { ShiftCloseRepository } from '../src/modules/Garage/infra/ShiftCloseRepository.js';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine.js';

describe('ShiftCloseRepository NeDB', () => {
    beforeAll(async () => {
        // Force NEDB
        StorageEngine.getEngine = () => 'USE_MARKER'; // which resolves to NeDB or directly NEDB
        // In the app, getEngine() returns 'NEDB' or 'SQLITE'
        const currentEngine = StorageEngine.getEngine();
        console.log('Current engine:', currentEngine);

        await db.shiftCloses.remove({}, { multi: true });
        
        await db.shiftCloses.insert({
            id: 'S1',
            garageId: 'G1',
            operator: 'WALTER',
            staying_in_cash: 434392,
            timestamp: new Date()
        });
    });

    it('should find S1 via findAll in NeDB mode', async () => {
        // Ensure StorageEngine returns NEDB
        const origGetEngine = StorageEngine.getEngine;
        StorageEngine.getEngine = () => 'NEDB';
        
        const repo = new ShiftCloseRepository();
        const results = await repo.findAll();
        expect(results.length).toBeGreaterThan(0);
        expect(results.find((r: any) => r.id === 'S1')).toBeDefined();
        
        StorageEngine.getEngine = origGetEngine;
    });
});
