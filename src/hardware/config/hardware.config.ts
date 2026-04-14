/**
 * hardware.config.ts — Persistent Configuration for Hardware Module
 *
 * Stores hardware config as a JSON file in the data directory.
 * The renderer sends config changes via IPC → HardwareOrchestrator saves here.
 * On startup, the orchestrator loads this file (or falls back to DEFAULT).
 */

import path from 'path';
import fs from 'fs';
import { HardwareConfig, DEFAULT_HARDWARE_CONFIG } from '../HardwareAbstractionLayer';

const CONFIG_FILENAME = 'hardware_config.json';

function resolveConfigPath(): string {
    let dataDir: string;
    try {
        const { app } = require('electron');
        if (app && app.isPackaged) {
            dataDir = path.join(app.getPath('userData'), 'database');
        } else {
            dataDir = path.resolve(process.cwd(), '.data');
        }
    } catch {
        dataDir = path.resolve(process.cwd(), '.data');
    }

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    return path.join(dataDir, CONFIG_FILENAME);
}

/**
 * Load hardware config from disk.
 * Returns DEFAULT_HARDWARE_CONFIG if file doesn't exist or is corrupted.
 */
export function loadHardwareConfig(): HardwareConfig {
    const configPath = resolveConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const parsed = JSON.parse(raw);
            // Deep merge with defaults to handle missing keys after upgrades
            return {
                mockMode: parsed.mockMode ?? DEFAULT_HARDWARE_CONFIG.mockMode,
                barrier: { ...DEFAULT_HARDWARE_CONFIG.barrier, ...parsed.barrier },
                camera: { ...DEFAULT_HARDWARE_CONFIG.camera, ...parsed.camera },
                scanner: { ...DEFAULT_HARDWARE_CONFIG.scanner, ...parsed.scanner },
                reconnect: { ...DEFAULT_HARDWARE_CONFIG.reconnect, ...parsed.reconnect },
            };
        }
    } catch (err) {
        console.error('⚠️ [HardwareConfig] Error loading config, using defaults:', err);
    }
    return { ...DEFAULT_HARDWARE_CONFIG };
}

/**
 * Save hardware config to disk.
 */
export function saveHardwareConfig(config: HardwareConfig): void {
    const configPath = resolveConfigPath();
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log('💾 [HardwareConfig] Config saved to:', configPath);
    } catch (err) {
        console.error('❌ [HardwareConfig] Error saving config:', err);
    }
}
