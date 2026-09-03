import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './datastore.js';

export type EngineState = 'NEDB' | 'CUTOVER_PREPARED' | 'SQLITE';

export class StorageEngine {
    private static inMemoryEngine: EngineState | null = null;

    private static getMarkerPath(): string {
        const isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
        if (isTestEnv) {
            const testDir = path.join(DATA_DIR, 'test');
            if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
            return path.join(testDir, 'test_storage-engine.json');
        }
        return path.join(DATA_DIR, 'storage-engine.json');
    }

    public static getEngine(): EngineState {
        const isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
        if (isTestEnv && this.inMemoryEngine) {
            return this.inMemoryEngine;
        }
        const markerPath = this.getMarkerPath();
        if (!fs.existsSync(markerPath)) {
            return 'NEDB';
        }
        try {
            const data = fs.readFileSync(markerPath, 'utf-8');
            const parsed = JSON.parse(data);
            if (['NEDB', 'CUTOVER_PREPARED', 'SQLITE'].includes(parsed.engine)) {
                return parsed.engine as EngineState;
            }
        } catch (e) {
            console.error('Error reading storage-engine.json:', e);
        }
        return 'NEDB';
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
            // Escribir temp
            fs.writeFileSync(tmpPath, payload, 'utf-8');
            
            // Sincronizar archivo al disco
            try {
                const fd = fs.openSync(tmpPath, 'r+');
                fs.fsyncSync(fd);
                fs.closeSync(fd);
            } catch {}
            
            // Rename atómico
            fs.renameSync(tmpPath, markerPath);
        } catch (err) {
            // Fallback direct write if rename was locked by concurrent worker
            fs.writeFileSync(markerPath, payload, 'utf-8');
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        }
        console.log(`[StorageEngine] Marker actualizado a: ${engine}`);
    }
}
