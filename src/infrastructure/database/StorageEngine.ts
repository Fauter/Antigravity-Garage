import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './datastore'; // or define it here if needed

export type EngineState = 'NEDB' | 'CUTOVER_PREPARED' | 'SQLITE';

export class StorageEngine {
    private static MARKER_PATH = path.join(DATA_DIR, 'storage-engine.json');

    public static getEngine(): EngineState {
        if (!fs.existsSync(this.MARKER_PATH)) {
            return 'NEDB';
        }
        try {
            const data = fs.readFileSync(this.MARKER_PATH, 'utf-8');
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
        const tmpPath = `${this.MARKER_PATH}.tmp`;
        const payload = JSON.stringify({ engine, timestamp: new Date().toISOString() });
        
        // Escribir temp
        fs.writeFileSync(tmpPath, payload, 'utf-8');
        
        // Sincronizar archivo al disco
        const fd = fs.openSync(tmpPath, 'r+');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        
        // Rename atómico
        fs.renameSync(tmpPath, this.MARKER_PATH);
        console.log(`[StorageEngine] Marker actualizado a: ${engine}`);
    }
}
