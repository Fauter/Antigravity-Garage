import { describe, it, expect, beforeAll } from 'vitest';
import { db, DATA_DIR } from '../src/infrastructure/database/datastore';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import path from 'path';

// Simulation of canonical equivalence according to domain rules
function semanticEquivalent(nedbDoc: any, sqliteRow: any): boolean {
    const jsonStr = sqliteRow.json_data || '{}';
    let reconstructed = {};
    try { reconstructed = JSON.parse(jsonStr); } catch (e) {}

    for (const [key, value] of Object.entries(reconstructed)) {
        if (value === null) continue; // missing

        // camelCase conversion (NeDB already has camelCase, but just in case)
        let camelKey = key;
        
        // Semantic type restoration based on NeDB original
        let restoredValue = value;
        if (nedbDoc[camelKey] instanceof Date) {
            restoredValue = new Date(value as string);
        } else if (typeof nedbDoc[camelKey] === 'boolean' && typeof value === 'number') {
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

import { MigrationOrchestrator } from '../src/infrastructure/database/sqlite/MigrationOrchestrator';

describe('Phase 1.75 Roundtrip Semantics', () => {
    let sqlite: any;

    beforeAll(async () => {
        // Force recreation of the shadow DB by deleting the file
        const fs = require('fs');
        try { fs.unlinkSync(path.join(DATA_DIR, 'test', 'test_garageia-shadow.sqlite')); } catch (e) {}
        try { fs.unlinkSync(path.join(DATA_DIR, 'test', 'test_garageia-shadow.sqlite-wal')); } catch (e) {}
        try { fs.unlinkSync(path.join(DATA_DIR, 'test', 'test_garageia-shadow.sqlite-shm')); } catch (e) {}
        
        await MigrationOrchestrator.initializeShadow();
        sqlite = SQLiteManager.getInstance().getDatabase();
    });

    it('should perfectly roundtrip boolean, undefined, and Date across all stays', async () => {
        const stays = await db.stays.find({});
        for (const stay of stays) {
            const rawRow = sqlite.prepare('SELECT json_data FROM stays WHERE id = ?').get(stay._id || stay.id) as any;
            if (!rawRow) {
                // Try with json_extract if ID wasn't perfectly mapped
                const fallback = sqlite.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$._id') = ?").get(stay._id) as any;
                expect(fallback).toBeDefined();
                expect(semanticEquivalent(stay, fallback)).toBe(true);
            } else {
                expect(semanticEquivalent(stay, rawRow)).toBe(true);
            }
        }
    });

    it('should preserve strictly identical numeric sums (Financial IEEE 754)', async () => {
        const movements = await db.movements.find({});
        let nedbSum = 0;
        let sqliteSum = 0;
        
        for (const m of movements) {
            if (m.amount) nedbSum += m.amount;
            const rawRow = sqlite.prepare('SELECT json_data FROM movements WHERE id = ?').get(m._id || m.id) as any;
            if (rawRow) {
                const row = JSON.parse(rawRow.json_data);
                if (row.amount) sqliteSum += row.amount;
            } else {
                const fallback = sqlite.prepare("SELECT json_data FROM movements WHERE json_extract(json_data, '$._id') = ?").get(m._id) as any;
                if (fallback) {
                    const row = JSON.parse(fallback.json_data);
                    if (row.amount) sqliteSum += row.amount;
                }
            }
        }

        expect(sqliteSum).toBe(nedbSum);
    });
});
