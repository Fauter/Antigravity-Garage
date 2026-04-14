/**
 * MockBarrierDriver.ts — Mock implementation for development/testing.
 *
 * Simulates a barrier that is always online and always succeeds.
 * Preserves the randomPlate() and photo placeholder logic from the
 * original HardwareService.js so the simulator keeps working.
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import type { IBarrierDriver, DriverHealth, HardwareEntryEvent } from '../HardwareAbstractionLayer';

// ── Plate & Photo Helpers (extracted from old HardwareService.js) ────

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

export function randomPlate(): string {
    const l = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const d = () => DIGITS[Math.floor(Math.random() * DIGITS.length)];
    return `${l()}${l()}${d()}${d()}${d()}${l()}${l()}`;
}

function getCapturesDir(): string {
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
    const dir = path.join(dataDir, '..', 'captures');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function generatePlaceholderPhoto(): string {
    const capturesDir = getCapturesDir();
    const filename = `mock_${Date.now()}_${uuidv4().slice(0, 8)}.txt`;
    const filepath = path.join(capturesDir, filename);
    fs.writeFileSync(filepath, `MOCK_CAPTURE_${new Date().toISOString()}`);
    return filepath;
}

// ── MockBarrierDriver ────────────────────────────────────────────────

export class MockBarrierDriver implements IBarrierDriver {
    readonly driverType = 'MOCK';
    readonly driverName = 'Simulador de Barrera';

    private _connected = false;
    private _connectedAt: Date | null = null;
    private _buttonCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _vehicleCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];

    async connect(): Promise<void> {
        this._connected = true;
        this._connectedAt = new Date();
        console.log('🎮 [MockBarrierDriver] Connected (simulated)');
    }

    async disconnect(): Promise<void> {
        this._connected = false;
        this._connectedAt = null;
        console.log('🎮 [MockBarrierDriver] Disconnected');
    }

    isConnected(): boolean {
        return this._connected;
    }

    getHealth(): DriverHealth {
        return {
            online: this._connected,
            lastHeartbeat: this._connected ? new Date() : null,
            lastError: null,
            reconnectAttempts: 0,
            uptimeMs: this._connectedAt ? Date.now() - this._connectedAt.getTime() : 0,
        };
    }

    async openBarrier(type: 'ENTRY' | 'EXIT'): Promise<boolean> {
        console.log(`🎮 [MockBarrierDriver] openBarrier(${type}) — simulated OK`);
        return true;
    }

    async closeBarrier(type: 'ENTRY' | 'EXIT'): Promise<boolean> {
        console.log(`🎮 [MockBarrierDriver] closeBarrier(${type}) — simulated OK`);
        return true;
    }

    getBarrierState(_type: 'ENTRY' | 'EXIT'): 'OPEN' | 'CLOSED' | 'UNKNOWN' {
        return 'CLOSED'; // Mock: barrier is always closed until opened
    }

    onButtonPress(callback: (type: 'ENTRY' | 'EXIT') => void): void {
        this._buttonCallbacks.push(callback);
    }

    onVehicleDetected(callback: (type: 'ENTRY' | 'EXIT') => void): void {
        this._vehicleCallbacks.push(callback);
    }

    // ── Simulator-only methods ──

    /** Called by the simulator to trigger a mock button press */
    simulateButtonPress(type: 'ENTRY' | 'EXIT'): void {
        this._buttonCallbacks.forEach(cb => cb(type));
    }

    /** Called by the simulator to trigger a mock vehicle detection */
    simulateVehicleDetected(type: 'ENTRY' | 'EXIT'): void {
        this._vehicleCallbacks.forEach(cb => cb(type));
    }
}
