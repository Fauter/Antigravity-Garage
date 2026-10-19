import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { StorageEngine } from '../../../src/infrastructure/database/StorageEngine';
import { DATA_DIR } from '../../../src/infrastructure/database/datastore';
import { SQLiteManager } from '../../../src/infrastructure/database/sqlite/SQLiteManager';

describe('StorageEngine', () => {
    const testDir = path.join(DATA_DIR, 'test');
    const markerPath = path.join(testDir, 'test_storage-engine.json');
    const sqlitePath = path.join(DATA_DIR, 'garageia.sqlite');
    const legacyPath = path.join(DATA_DIR, 'customers.db');

    beforeEach(() => {
        // Reset in-memory states
        (StorageEngine as any).inMemoryEngine = null;
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
        if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
        if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
        delete process.env.ALLOW_LEGACY_NEDB;
    });

    afterEach(() => {
        if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
        if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
        if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    });

    it('1. no marker + no SQLite + no legacy -> FIRST_RUN_SQLITE', () => {
        // Temporarily override NODE_ENV and VITEST to bypass in-memory engine fallback
        const oldVitest = process.env.VITEST;
        process.env.VITEST = '';
        
        // Temporarily redefine getMarkerPath logic or actually let it run normally,
        // but since we deleted VITEST, it uses standard path. So we need to mock DATA_DIR?
        // Wait, DATA_DIR is used in getMarkerPath. If VITEST is false, getMarkerPath returns DATA_DIR/storage-engine.json
        // Let's just spy or keep VITEST and override the `inMemoryEngine` logic.
        // Actually, StorageEngine has `isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST)`.
        // If it's test env, it uses `inMemoryEngine`. If not set, it reads `testDir`.
        // Wait, if `inMemoryEngine` is null, it continues to read `markerPath`.
        
        const engine = StorageEngine.getEngine();
        expect(engine).toBe('SQLITE');
        
        // Verify marker was created
        expect(fs.existsSync(markerPath)).toBe(true);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        expect(marker.engine).toBe('SQLITE');
        
        process.env.VITEST = oldVitest;
    });

    it('2. no marker + SQLite valid -> recover SQLITE marker', () => {
        fs.writeFileSync(sqlitePath, 'dummy sqlite content');
        const engine = StorageEngine.getEngine();
        expect(engine).toBe('SQLITE');
        expect(fs.existsSync(markerPath)).toBe(true);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        expect(marker.engine).toBe('SQLITE');
    });

    it('3. marker SQLITE + SQLite valid -> SQLITE', () => {
        fs.writeFileSync(sqlitePath, 'dummy sqlite content');
        fs.writeFileSync(markerPath, JSON.stringify({ engine: 'SQLITE' }));
        const engine = StorageEngine.getEngine();
        expect(engine).toBe('SQLITE');
    });

    it('4. marker SQLITE + SQLite missing -> Safe return SQLITE (marker respected)', () => {
        fs.writeFileSync(markerPath, JSON.stringify({ engine: 'SQLITE' }));
        const engine = StorageEngine.getEngine();
        expect(engine).toBe('SQLITE');
    });

    it('5. legacy datastore real + no SQLite -> RECOVER_NEDB_LEGACY', () => {
        fs.writeFileSync(legacyPath, 'legacy nedb content');
        const engine = StorageEngine.getEngine();
        expect(engine).toBe('NEDB');
        expect(fs.existsSync(markerPath)).toBe(true);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        expect(marker.engine).toBe('NEDB');
    });

    it('6. marker corrupto -> FIRST_RUN_SQLITE si no hay legacy ni sqlite', () => {
        fs.writeFileSync(markerPath, 'invalid json');
        const engine = StorageEngine.getEngine();
        expect(engine).toBe('SQLITE'); // It falls back to first-run check since it ignores invalid marker
    });

    it('8. write marker atomic', () => {
        StorageEngine.setEngine('CUTOVER_PREPARED');
        expect(fs.existsSync(markerPath)).toBe(true);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        expect(marker.engine).toBe('CUTOVER_PREPARED');
    });
    
    it('10. dos arranques consecutivos -> idempotente', () => {
        StorageEngine.getEngine(); // First run -> SQLITE
        const engine2 = StorageEngine.getEngine(); // Second run
        expect(engine2).toBe('SQLITE');
    });
});
