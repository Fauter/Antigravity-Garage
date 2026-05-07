/**
 * MockBarrierDriver.ts — Mock implementation for development/testing.
 *
 * Simulates a barrier that is always online and always succeeds.
 * Preserves the randomPlate() and photo placeholder logic from the
 * original HardwareService.js so the simulator keeps working.
 *
 * Supports RFID and sensor simulation for the bidirectional ESP32 flows.
 *
 * v4.0 — Sensor-Aware Smart Close (Anti-Crush):
 *   - Minimum open time: 3s before any close attempt.
 *   - Safety timer: 5s from open → attempt close.
 *   - If sensor is OCCUPIED at close time, barrier stays OPEN and
 *     retries every 1s until sensor reports CLEAR.
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import type {
    IBarrierDriver,
    DriverHealth,
    HardwareEntryEvent,
    RfidScanEvent,
    SensorOccupancyState,
} from '../HardwareAbstractionLayer';

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

// ── Smart Close Configuration ────────────────────────────────────────

const SAFETY_TIMER_MS = 5000;      // Wait 5s after open before first close attempt
const MIN_OPEN_TIME_MS = 3000;     // Barrier must stay open at least 3s
const RETRY_INTERVAL_MS = 1000;    // If sensor OCCUPIED, retry close every 1s

// ── MockBarrierDriver ────────────────────────────────────────────────

export class MockBarrierDriver implements IBarrierDriver {
    readonly driverType = 'MOCK';
    readonly driverName = 'Simulador de Barrera';

    private _connected = false;
    private _connectedAt: Date | null = null;
    private _barrierStates: Record<'ENTRY' | 'EXIT', 'OPEN' | 'CLOSED'> = { ENTRY: 'CLOSED', EXIT: 'CLOSED' };
    private _barrierOpenedAt: Record<'ENTRY' | 'EXIT', number> = { ENTRY: 0, EXIT: 0 };
    private _autoCloseTimers: Record<'ENTRY' | 'EXIT', ReturnType<typeof setTimeout> | null> = { ENTRY: null, EXIT: null };
    private _retryTimers: Record<'ENTRY' | 'EXIT', ReturnType<typeof setInterval> | null> = { ENTRY: null, EXIT: null };
    private _barrierChangeCallbacks: ((type: 'ENTRY' | 'EXIT', state: 'OPEN' | 'CLOSED') => void)[] = [];
    private _buttonCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _vehicleCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _rfidCallbacks: ((event: RfidScanEvent) => void)[] = [];
    private _sensorCallbacks: ((state: SensorOccupancyState) => void)[] = [];

    // ── Sensor state tracked internally for smart-close decisions ──
    private _sensorState: SensorOccupancyState = 'CLEAR';

    async connect(): Promise<void> {
        this._connected = true;
        this._connectedAt = new Date();
        console.log('🎮 [MockBarrierDriver] Connected (simulated)');
    }

    async disconnect(): Promise<void> {
        this._connected = false;
        this._connectedAt = null;
        // Clean up all timers
        this._clearAllTimers('ENTRY');
        this._clearAllTimers('EXIT');
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

        // Clear any existing timers for this barrier
        this._clearAllTimers(type);

        // Track barrier state: OPEN now
        this._barrierStates[type] = 'OPEN';
        this._barrierOpenedAt[type] = Date.now();
        this._notifyBarrierStateChange(type, 'OPEN');

        // ── Sensor-Aware Smart Close ──
        // Start safety timer: after SAFETY_TIMER_MS, attempt to close
        this._autoCloseTimers[type] = setTimeout(() => {
            this._attemptSmartClose(type);
        }, SAFETY_TIMER_MS);

        return true;
    }

    async closeBarrier(type: 'ENTRY' | 'EXIT'): Promise<boolean> {
        console.log(`🎮 [MockBarrierDriver] closeBarrier(${type}) — simulated OK`);
        this._clearAllTimers(type);
        this._barrierStates[type] = 'CLOSED';
        this._notifyBarrierStateChange(type, 'CLOSED');
        return true;
    }

    getBarrierState(type: 'ENTRY' | 'EXIT'): 'OPEN' | 'CLOSED' | 'UNKNOWN' {
        return this._barrierStates[type];
    }

    /** Subscribe to barrier state changes (used by Orchestrator for LED propagation) */
    onBarrierStateChanged(callback: (type: 'ENTRY' | 'EXIT', state: 'OPEN' | 'CLOSED') => void): void {
        this._barrierChangeCallbacks.push(callback);
    }

    onButtonPress(callback: (type: 'ENTRY' | 'EXIT') => void): void {
        this._buttonCallbacks.push(callback);
    }

    onVehicleDetected(callback: (type: 'ENTRY' | 'EXIT') => void): void {
        this._vehicleCallbacks.push(callback);
    }

    onRfidScanned(callback: (event: RfidScanEvent) => void): void {
        this._rfidCallbacks.push(callback);
    }

    onSensorStateChanged(callback: (state: SensorOccupancyState) => void): void {
        this._sensorCallbacks.push(callback);
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

    /**
     * Simulate an RFID scan from the Simulator UI.
     * Generates a RfidScanEvent and fires all registered callbacks.
     */
    simulateRfidScan(rfidCode: string): RfidScanEvent {
        const event: RfidScanEvent = {
            rfidCode: rfidCode.toUpperCase().trim(),
            timestamp: new Date().toISOString(),
            source: 'SIMULATOR',
        };
        console.log(`🎮 [MockBarrierDriver] Simulated RFID scan: ${event.rfidCode}`);
        this._rfidCallbacks.forEach(cb => cb(event));
        return event;
    }

    /**
     * Simulate a sensor state change from the Simulator UI.
     * Fires all registered sensor callbacks AND updates internal tracking.
     */
    simulateSensorState(state: SensorOccupancyState): void {
        console.log(`🎮 [MockBarrierDriver] Simulated sensor state → ${state}`);
        this._sensorState = state;
        this._sensorCallbacks.forEach(cb => cb(state));

        // ── If sensor just went CLEAR, check if any barrier is waiting to close ──
        // The retry interval handles this, but this gives an immediate reaction
        if (state === 'CLEAR') {
            (['ENTRY', 'EXIT'] as const).forEach(type => {
                if (this._barrierStates[type] === 'OPEN' && this._retryTimers[type]) {
                    // There's an active retry — the next tick will catch CLEAR
                    // But let's also do an immediate attempt for responsiveness
                    this._attemptSmartClose(type);
                }
            });
        }
    }

    // ── Private: Smart Close Logic ──────────────────────────────────

    /**
     * Attempt to close the barrier, respecting sensor state and min open time.
     * If conditions aren't met, starts a retry interval.
     */
    private _attemptSmartClose(type: 'ENTRY' | 'EXIT'): void {
        // Guard: barrier might have been manually closed already
        if (this._barrierStates[type] !== 'OPEN') {
            this._clearAllTimers(type);
            return;
        }

        const elapsedMs = Date.now() - this._barrierOpenedAt[type];

        // Condition 1: Minimum open time
        if (elapsedMs < MIN_OPEN_TIME_MS) {
            console.log(`🎮 [MockBarrierDriver] ${type}: Too early to close (${elapsedMs}ms < ${MIN_OPEN_TIME_MS}ms)`);
            // Schedule for remaining time
            const remaining = MIN_OPEN_TIME_MS - elapsedMs;
            this._autoCloseTimers[type] = setTimeout(() => {
                this._attemptSmartClose(type);
            }, remaining);
            return;
        }

        // Condition 2: Sensor must be CLEAR
        if (this._sensorState === 'OCCUPIED') {
            console.log(`🎮 [MockBarrierDriver] ${type}: Sensor OCCUPIED — barrier stays OPEN (anti-crush active)`);

            // Start retry interval if not already running
            if (!this._retryTimers[type]) {
                this._retryTimers[type] = setInterval(() => {
                    if (this._sensorState === 'CLEAR') {
                        console.log(`🎮 [MockBarrierDriver] ${type}: Sensor now CLEAR — closing barrier`);
                        this._executeClose(type);
                    } else {
                        console.log(`🎮 [MockBarrierDriver] ${type}: Retry — sensor still OCCUPIED, waiting...`);
                    }
                }, RETRY_INTERVAL_MS);
            }
            return;
        }

        // Both conditions met: close the barrier
        this._executeClose(type);
    }

    /**
     * Actually close the barrier and clean up all timers.
     */
    private _executeClose(type: 'ENTRY' | 'EXIT'): void {
        this._clearAllTimers(type);
        this._barrierStates[type] = 'CLOSED';
        this._notifyBarrierStateChange(type, 'CLOSED');
        const totalOpenMs = Date.now() - this._barrierOpenedAt[type];
        console.log(`🎮 [MockBarrierDriver] Barrier ${type} auto-closed after ${(totalOpenMs / 1000).toFixed(1)}s (sensor-aware)`);
    }

    /**
     * Fire all barrier state change callbacks.
     */
    private _notifyBarrierStateChange(type: 'ENTRY' | 'EXIT', state: 'OPEN' | 'CLOSED'): void {
        this._barrierChangeCallbacks.forEach(cb => cb(type, state));
    }

    /**
     * Clear all timers (safety timer + retry interval) for a barrier type.
     */
    private _clearAllTimers(type: 'ENTRY' | 'EXIT'): void {
        if (this._autoCloseTimers[type]) {
            clearTimeout(this._autoCloseTimers[type]!);
            this._autoCloseTimers[type] = null;
        }
        if (this._retryTimers[type]) {
            clearInterval(this._retryTimers[type]!);
            this._retryTimers[type] = null;
        }
    }
}
