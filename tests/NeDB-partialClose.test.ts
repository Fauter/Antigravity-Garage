import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/infrastructure/database/datastore.js';
import { PartialCloseRepository } from '../src/modules/Garage/infra/PartialCloseRepository.js';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine.js';

describe('PartialCloseRepository NeDB', () => {
    beforeAll(async () => {
        StorageEngine.getEngine = () => 'USE_MARKER';
        await db.partialCloses.remove({}, { multi: true });
        
        await db.partialCloses.insert({
            id: 'P1',
            garageId: 'G1',
            operator: 'WALTER',
            amount: 5000,
            timestamp: new Date()
        });
    });

    it('should find P1 via findAll in NeDB mode', async () => {
        const origGetEngine = StorageEngine.getEngine;
        StorageEngine.getEngine = () => 'NEDB';
        
        const repo = new PartialCloseRepository();
        const results = await repo.findAll();
        expect(results.length).toBeGreaterThan(0);
        expect(results.find((r: any) => r.id === 'P1')).toBeDefined();
        
        StorageEngine.getEngine = origGetEngine;
    });
});
