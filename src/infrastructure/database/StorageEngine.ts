import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './datastore.js';

export type EngineState = 'NEDB' | 'CUTOVER_PREPARED' | 'SQLITE';

export class StorageEngine {
    private static inMemoryEngine: EngineState | null = null;
    public static isFirstRunSession: boolean = false;

    private static getMarkerPath(): string {
        const isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
        if (isTestEnv) {
            const testDir = path.join(DATA_DIR, 'test');
            if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
            return path.join(testDir, 'test_storage-engine.json');
        }
        return path.join(DATA_DIR, 'storage-engine.json');
    }

    private static lastLogHash: string | null = null;

    public static getEngine(): EngineState {
        const isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
        if (isTestEnv && this.inMemoryEngine) {
            return this.inMemoryEngine;
        }

        const markerPath = this.getMarkerPath();
        const markerExists = fs.existsSync(markerPath);
        
        let markerEngine: EngineState | null = null;
        let hasValidMarker = false;
        if (markerExists) {
            try {
                const data = fs.readFileSync(markerPath, 'utf-8');
                const parsed = JSON.parse(data);
                if (['NEDB', 'CUTOVER_PREPARED', 'SQLITE'].includes(parsed.engine)) {
                    markerEngine = parsed.engine as EngineState;
                    hasValidMarker = true;
                }
            } catch (e) {
                console.error('[STORAGE] Error reading storage-engine.json:', e);
            }
        }
        
        const sqliteDbPath = path.join(DATA_DIR, 'garageia.sqlite');
        const sqliteExists = fs.existsSync(sqliteDbPath);
        
        const legacyPath = path.join(DATA_DIR, 'customers.db');
        const legacyExists = fs.existsSync(legacyPath);
        
        let resolvedEngine: EngineState | null = null;
        let resolutionReason = '';

        if (hasValidMarker && markerEngine) {
            resolvedEngine = markerEngine;
            resolutionReason = 'USE_MARKER';
        } else if (!hasValidMarker && sqliteExists) {
            resolvedEngine = 'SQLITE';
            resolutionReason = 'RECOVER_SQLITE';
        } else if (!hasValidMarker && !sqliteExists && !legacyExists) {
            resolvedEngine = 'SQLITE';
            resolutionReason = 'FIRST_RUN_SQLITE';
            this.isFirstRunSession = true;
        } else if (!hasValidMarker && !sqliteExists && legacyExists) {
            resolvedEngine = 'NEDB';
            resolutionReason = 'RECOVER_NEDB_LEGACY';
        } else if (process.env.ALLOW_LEGACY_NEDB === 'true') {
            resolvedEngine = 'NEDB';
            resolutionReason = 'ALLOW_LEGACY_NEDB_OVERRIDE';
        }

        if (!resolvedEngine) {
            console.error('[STORAGE:FATAL] Cannot determine safe storage engine. Ambiguous state.');
            throw new Error('FATAL: Storage marker missing, no clear state detected (First Run vs Legacy vs SQLite). Cannot determine active engine safely.');
        }

        const currentLogHash = `${resolvedEngine}|${sqliteExists}|${legacyExists}|${markerEngine}|${resolutionReason}`;
        if (this.lastLogHash !== currentLogHash) {
            this.lastLogHash = currentLogHash;
            if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') {
                console.log(`[STORAGE:TRACE] markerPath=${markerPath}`);
                console.log(`[STORAGE:TRACE] markerExists=${markerExists}`);
                console.log(`[STORAGE:TRACE] sqliteExists=${sqliteExists}`);
                console.log(`[STORAGE:TRACE] legacyExists=${legacyExists}`);
            }
            console.log(`[STORAGE] engine=${resolvedEngine} | sqlite=${sqliteExists ? 'present' : 'missing'} | legacy=${legacyExists ? 'present' : 'missing'} | marker=${markerEngine || 'missing'} | reason=${resolutionReason}`);
        }

        if (resolutionReason !== 'USE_MARKER' && resolutionReason !== 'ALLOW_LEGACY_NEDB_OVERRIDE') {
            this.setEngine(resolvedEngine);
        }

        return resolvedEngine;
    }

    public static setEngine(engine: EngineState): void {
        const isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
        if (isTestEnv) {
            this.inMemoryEngine = engine;
        }
        const markerPath = this.getMarkerPath();
        const tmpPath = `${markerPath}.${Date.now()}_${Math.random().toString(36).substring(2, 7)}.tmp`;
        const payload = JSON.stringify({ engine, timestamp: new Date().toISOString() });
        
        try {
            // Write temp
            fs.writeFileSync(tmpPath, payload, 'utf-8');
            
            // Sync to disk
            try {
                const fd = fs.openSync(tmpPath, 'r+');
                fs.fsyncSync(fd);
                fs.closeSync(fd);
            } catch {}
            
            // Atomic rename
            fs.renameSync(tmpPath, markerPath);
        } catch (err) {
            // Fallback direct write if rename was locked by concurrent worker
            fs.writeFileSync(markerPath, payload, 'utf-8');
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        }
        if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') {
            console.log(`[STORAGE:TRACE] Marker updated to: ${engine}`);
        }
    }
}
