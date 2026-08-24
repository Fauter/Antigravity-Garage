import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/infrastructure/database/datastore';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';

// Simulation of canonical equivalence according to domain rules
function semanticEquivalent(nedbDoc: any, sqliteRow: any): boolean {
    const jsonStr = sqliteRow.json_data || '{}';
    let reconstructed = {};
    try { reconstructed = JSON.parse(jsonStr); } catch (e) {}

    // Reconstruct mapped columns
    for (const [key, value] of Object.entries(sqliteRow)) {
        if (key === 'json_data') continue;
        if (value === null) continue; // missing

        // camelCase conversion
        let camelKey = key;
        if (key === '_id') {
            camelKey = '_id';
        } else {
            camelKey = key.replace(/_([a-z])/g, g => g[1].toUpperCase());
        }
        
        // Semantic type restoration based on NeDB original (in real prod, we'd use schema definitions)
        let restoredValue = value;
        if (nedbDoc[camelKey] instanceof Date) {
            restoredValue = new Date(value as string);
        } else if (typeof nedbDoc[camelKey] === 'boolean') {
            restoredValue = value === 1;
        }

        reconstructed[camelKey] = restoredValue;
    }

    // Compare
    const cleanNeDB = { ...nedbDoc };
    // Remove undefined values to match reconstruction
    Object.keys(cleanNeDB).forEach(k => {
        if (cleanNeDB[k] === undefined) delete cleanNeDB[k];
    });

    try {
        expect(reconstructed).toEqual(cleanNeDB);
        return true;
    } catch (e) {
        console.error('Mismatch para _id:', nedbDoc._id);
        console.error('NeDB:', cleanNeDB);
        console.error('Reconstructed:', reconstructed);
        return false;
    }
}

describe('Phase 1.75 Roundtrip Semantics', () => {
    let sqlite: any;

    beforeAll(() => {
        sqlite = SQLiteManager.getInstance().getDatabase();
    });

    it('should perfectly roundtrip boolean, undefined, and Date across all stays', async () => {
        const stays = await db.stays.find({});
        for (const stay of stays) {
            const row = sqlite.prepare('SELECT * FROM stays WHERE _id = ?').get(stay._id);
            expect(row).toBeDefined();
            const isEquivalent = semanticEquivalent(stay, row);
            expect(isEquivalent).toBe(true);
        }
    });

    it('should preserve strictly identical numeric sums (Financial IEEE 754)', async () => {
        const movements = await db.movements.find({});
        let nedbSum = 0;
        let sqliteSum = 0;
        
        for (const m of movements) {
            if (m.amount) nedbSum += m.amount;
            const row = sqlite.prepare('SELECT amount FROM movements WHERE _id = ?').get(m._id);
            if (row && row.amount) sqliteSum += row.amount;
        }

        expect(Object.is(nedbSum, sqliteSum)).toBe(true); // Exact 64-bit float match
    });
});
