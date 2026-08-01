/**
 * HardwareOrchestrator.ts — Central orchestrator for all hardware drivers.
 *
 * This replaces the monolithic HardwareService.js. It:
 *  1. Loads persistent HardwareConfig from disk
 *  2. Initializes DriverRegistry with the correct drivers
 *  3. Registers ALL IPC handlers for hw:* channels
 *  4. Manages the Simulator window (Ctrl+Shift+D)
 *  5. Propagates driver state changes to the renderer
 *  6. Delegates exit-authorization queries to the backend HTTP API
 *     (eliminates the duplicate NeDB instance)
 *  7. Handles bidirectional ESP32 flows: RFID auto-exit, sensor telemetry
 *
 * CRITICAL: This module runs in the Electron Main Process.
 * All async operations have timeouts to prevent event-loop blocking.
 */

import { BrowserWindow, ipcMain, globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

import type {
    HardwareConfig,
    HardwareEntryEvent,
    HardwareStatus,
    BarrierAuthResult,
    RfidAuthResult,
    RfidScanEvent,
    SensorOccupancyState,
} from './HardwareAbstractionLayer';
import { DEFAULT_HARDWARE_CONFIG } from './HardwareAbstractionLayer';
import { DriverRegistry } from './DriverRegistry';
import { loadHardwareConfig, saveHardwareConfig } from './config/hardware.config';
import { MockCameraDriver } from './drivers/MockCameraDriver';
import { MockBarrierDriver } from './drivers/MockBarrierDriver';
import { AlprServiceManager } from './alpr/AlprServiceManager';

// ── Safe Driver Call Wrapper ─────────────────────────────────────────
// Prevents hardware I/O from blocking the Electron event loop.

async function safeDriverCall<T>(
    operation: () => Promise<T>,
    timeoutMs: number = 5000,
    fallback: T,
): Promise<T> {
    try {
        return await Promise.race([
            operation(),
            new Promise<T>((_, reject) =>
                setTimeout(() => reject(new Error('HW_TIMEOUT')), timeoutMs)
            ),
        ]);
    } catch (err: any) {
        console.error(`⚠️ [HardwareOrchestrator] Operation failed/timed out: ${err.message}`);
        return fallback;
    }
}

// ── Exit Authorization via Backend HTTP ──────────────────────────────
// Instead of opening a duplicate NeDB instance, we delegate to the
// existing /api/hardware/check-exit/:ticketCode endpoint.

function checkExitAuthorizationViaAPI(ticketCode: string): Promise<BarrierAuthResult> {
    return new Promise((resolve) => {
        const normalizedCode = ticketCode.trim().toUpperCase();
        const url = `http://localhost:3000/api/hardware/check-exit/${encodeURIComponent(normalizedCode)}`;

        const req = http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve(result);
                } catch {
                    resolve({ authorized: false, reason: 'NOT_FOUND', ticketCode: normalizedCode, error: 'Invalid API response' });
                }
            });
        });

        req.on('error', (err) => {
            console.error('❌ [HardwareOrchestrator] Backend API unreachable:', err.message);
            resolve({ authorized: false, reason: 'NOT_FOUND', ticketCode: normalizedCode, error: err.message });
        });

        // Timeout: if backend doesn't respond in 5s, fail safe
        req.setTimeout(5000, () => {
            req.destroy();
            resolve({ authorized: false, reason: 'NOT_FOUND', ticketCode: normalizedCode, error: 'API timeout' });
        });
    });
}

// ── RFID Authorization via Backend HTTP ──────────────────────────────
// Checks if an RFID tag is associated with a paid/subscriber stay.

function checkRfidAuthorizationViaAPI(rfidCode: string): Promise<RfidAuthResult> {
    return new Promise((resolve) => {
        const normalized = rfidCode.trim().toUpperCase();
        const url = `http://localhost:3000/api/hardware/check-rfid/${encodeURIComponent(normalized)}`;

        const req = http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve(result);
                } catch {
                    resolve({ authorized: false, reason: 'ERROR', rfidCode: normalized, error: 'Invalid API response' });
                }
            });
        });

        req.on('error', (err) => {
            console.error('❌ [HardwareOrchestrator] RFID API unreachable:', err.message);
            resolve({ authorized: false, reason: 'ERROR', rfidCode: normalized, error: err.message });
        });

        req.setTimeout(5000, () => {
            req.destroy();
            resolve({ authorized: false, reason: 'ERROR', rfidCode: normalized, error: 'API timeout' });
        });
    });
}

// ── Mark barrier exit as used via Backend ────────────────────────────
// POST to mark the stay as barrier_exit_used (so anti-passback works)

function markBarrierExitUsed(stayId: string): void {
    // Fire-and-forget PATCH to backend
    const payload = JSON.stringify({ barrier_exit_used: true, barrier_exit_at: new Date().toISOString() });
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/hardware/mark-exit-used/${encodeURIComponent(stayId)}`,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 3000,
    };

    const req = http.request(options);
    req.on('error', (err) => {
        console.error(`⚠️ [HardwareOrchestrator] mark-exit-used failed: ${err.message}`);
    });
    req.write(payload);
    req.end();
}

// ── Orchestrator Class ───────────────────────────────────────────────

export class HardwareOrchestrator {
    private mainWindow: BrowserWindow | null = null;
    private simulatorWindow: BrowserWindow | null = null;
    private alprManager: AlprServiceManager | null = null;
    private registry: DriverRegistry;
    private config: HardwareConfig;
    private isDev = false;
    private lastEventAt: string | null = null;
    private _ipcRegistered = false;
    private _shortcutRegistered = false;

    // ── Automated Flow State: prevents event duplication ──
    private _isAutomatedFlowActive = false;
    private _capturedCameraEvent: HardwareEntryEvent | null = null;

    // ── Deduplication: track recent event IDs to prevent double-processing ──
    private _recentEventIds: Set<string> = new Set();
    private _dedupeWindowMs = 3000; // 3 second window

    // ── RFID deduplication: prevent rapid-fire scans of the same tag ──
    private _lastRfidCode: string | null = null;
    private _lastRfidAt = 0;
    private _rfidDedupeMs = 5000; // 5 second cooldown per tag

    // ── Sensor telemetry state (latest known from ESP32 / mock) ──
    private _sensorState: SensorOccupancyState = 'UNKNOWN';

    constructor() {
        this.registry = new DriverRegistry();
        this.config = DEFAULT_HARDWARE_CONFIG;
    }

    /**
     * Returns the effective config: if mockMode is ON, all drivers are forced to MOCK.
     * The stored this.config retains the real values so they can be restored.
     */
    private getEffectiveConfig(): HardwareConfig {
        if (this.config.mockMode) {
            return {
                ...this.config,
                barrier: { ...this.config.barrier, driver: 'MOCK' as const },
                camera: { ...this.config.camera, driver: 'MOCK' as const },
                scanner: { ...this.config.scanner, driver: 'MOCK' as const },
            };
        }
        return this.config;
    }

    /**
     * Wire camera events to the entry handler.
     * IMPORTANT: Must be called only ONCE after each driver init/reconfigure,
     * and only after the previous listeners were cleaned up by the registry.
     */
    private wireCameraEvents(): void {
        try {
            this.registry.camera.onPlateDetected((event) => {
                // If we are currently processing a button press, intercept the camera event.
                // This prevents duplicating the entry in the frontend queue, while still
                // allowing us to capture the photo/plate for the single unified event.
                if (this._isAutomatedFlowActive) {
                    this._capturedCameraEvent = event;
                } else {
                    this.handleEntryEvent(event);
                }
            });
        } catch (err: any) {
            console.warn(`[HW-DEBUG] wireCameraEvents failed (camera may not be initialized): ${err.message}`);
        }
    }

    /**
     * Wire barrier bidirectional events: RFID scans and sensor telemetry.
     * Called once after each driver init/reconfigure.
     */
    private wireBarrierEvents(): void {
        try {
            // ── RFID: ESP32 scanned a tag at exit barrier ──
            this.registry.barrier.onRfidScanned((event: RfidScanEvent) => {
                this.handleRfidScan(event);
            });

            // ── Sensor: Anti-crush radar state changes ──
            this.registry.barrier.onSensorStateChanged((state: SensorOccupancyState) => {
                this.handleSensorStateChange(state);
            });

            // ── Barrier State: Propagate open/close to frontend for LED indicators ──
            const barrier = this.registry.barrier as any;
            if (typeof barrier.onBarrierStateChanged === 'function') {
                barrier.onBarrierStateChanged((_type: 'ENTRY' | 'EXIT', _state: 'OPEN' | 'CLOSED') => {
                    this.emitStatusToRenderer();
                });
            }

            // ── Button Press: ESP32 physical button → automated entry flow ──
            this.registry.barrier.onButtonPress((type: 'ENTRY' | 'EXIT') => {
                this.handleAutomatedEntryFlow(type);
            });

            console.log('[HW-DEBUG] ✅ Barrier bidirectional events wired (incl. button press)');
        } catch (err: any) {
            console.warn(`[HW-DEBUG] wireBarrierEvents failed: ${err.message}`);
        }
    }

    /**
     * Create a status change callback for driver state events.
     */
    private createStatusChangeCallback(): (driverType: string, online: boolean) => void {
        return (driverType: string, online: boolean) => {
            this.emitStatusToRenderer();
            console.log(`${online ? '✅' : '❌'} [HardwareOrchestrator] ${driverType} is now ${online ? 'ONLINE' : 'OFFLINE'}`);

            // Emit connection toast to renderer
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('hw:driver-status-toast', {
                    driverType,
                    online,
                    message: online
                        ? `${driverType === 'ETHERNET_RELAY' ? 'Barreras' : (driverType === 'ANPR_WEBHOOK' || driverType === 'HIKVISION_ISAPI') ? 'Cámara' : driverType} conectado`
                        : `${driverType === 'ETHERNET_RELAY' ? 'Barreras' : (driverType === 'ANPR_WEBHOOK' || driverType === 'HIKVISION_ISAPI') ? 'Cámara' : driverType} desconectado`,
                });
            }
        };
    }

    /**
     * Initialize the hardware layer. Called from main.js (via the shim).
     */
    async initialize(mainWindow: BrowserWindow, isDev: boolean): Promise<void> {
        console.log('[HW-DEBUG] Orchestrator Initializing...');
        this.mainWindow = mainWindow;
        this.isDev = isDev;

        // Start ALPR Service
        this.alprManager = new AlprServiceManager();
        this.alprManager.start().catch(err => {
            console.error(`[HW-DEBUG] ❌ Failed to start ALPR service:`, err);
        });

        // ── Step 1: Load persistent config (synchronous, never throws) ──
        this.config = loadHardwareConfig();
        console.log(`[HW-DEBUG] Config loaded: barrier=${this.config.barrier.driver}, camera=${this.config.camera.driver}`);

        // ── Step 2: Register IPC handlers IMMEDIATELY (synchronous) ──
        if (!this._ipcRegistered) {
            this.registerIPCHandlers();
            this._ipcRegistered = true;
            console.log('[HW-DEBUG] IPC handlers registered (before driver init)');
        }

        // ── Step 3: Register keyboard shortcut (synchronous) ──
        this.registerSimulatorShortcut();

        // ── Step 4: Initialize drivers (async, may fail — system stays functional) ──
        try {
            await this.registry.initialize(
                this.getEffectiveConfig(),
                this.createStatusChangeCallback()
            );

            // Wire up camera events → forward to renderer
            this.wireCameraEvents();

            // Wire up barrier bidirectional events (RFID + sensor)
            this.wireBarrierEvents();

            const status = this.registry.getStatus();
            console.log(`[HW-DEBUG] Drivers initialized. Driver: ${status.driverType}. Ctrl+Shift+D → Simulator`);
        } catch (err: any) {
            console.error(`[HW-DEBUG] ❌ Driver initialization failed (system continues in degraded mode): ${err.message}`);
        }

        console.log('[HW-DEBUG] ✅ Orchestrator initialization complete');
    }

    // ── IPC Handlers ─────────────────────────────────────────────────

    private registerIPCHandlers(): void {

        // ── Simulate entry (called from Simulator window) ──
        ipcMain.handle('hw:simulate-entry', async () => {
            const camera = this.registry.camera;

            if (camera instanceof MockCameraDriver) {
                const event = await camera.simulateDetection();
                this.handleEntryEvent(event);
                return event;
            }

            // Si hay un driver real (ej: Hikvision), capturamos y armamos el evento
            let photoPath = '';
            try {
                photoPath = await safeDriverCall(() => camera.triggerCapture(), 3000, '');
            } catch (err: any) {
                console.warn(`[HardwareOrchestrator] Simulator real-camera capture failed: ${err.message}`);
            }

            const event: HardwareEntryEvent = {
                id: uuidv4(),
                timestamp: new Date().toISOString(),
                photoPath, // Base64 comprimido o vacío si falló
                suggestedPlate: '', // ISAPI no hace OCR por defecto
                ocrStatus: 'NOT_FOUND',
                source: 'SIMULATOR',
            };

            this.handleEntryEvent(event);
            return event;
        });

        // ── Barcode scan at exit barrier ──
        ipcMain.handle('hw:simulate-barcode', async (_event, ticketCode: string) => {
            const result = await checkExitAuthorizationViaAPI(ticketCode);

            if (result.authorized) {
                await safeDriverCall(
                    () => this.registry.barrier.openBarrier('EXIT'),
                    3000,
                    false
                );
                if (result.stayId) {
                    markBarrierExitUsed(result.stayId);
                }
            }

            if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
                this.simulatorWindow.webContents.send('sim:exit-result', result);
            }
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('hw:barrier-auth-result', result);
            }

            return result;
        });

        // ── Simulate RFID scan (called from Simulator window) ──
        ipcMain.handle('hw:simulate-rfid', async (_event, rfidCode: string) => {
            const barrier = this.registry.barrier;

            if (barrier instanceof MockBarrierDriver) {
                const scanEvent = barrier.simulateRfidScan(rfidCode);
                // handleRfidScan is triggered via the callback wired in wireBarrierEvents
                return scanEvent;
            }

            // For real drivers, inject event manually
            const scanEvent: RfidScanEvent = {
                rfidCode: rfidCode.toUpperCase().trim(),
                timestamp: new Date().toISOString(),
                source: 'SIMULATOR',
            };
            this.handleRfidScan(scanEvent);
            return scanEvent;
        });

        // ── Simulate sensor state (called from Simulator window) ──
        ipcMain.handle('hw:simulate-sensor', async (_event, state: SensorOccupancyState) => {
            const barrier = this.registry.barrier;

            if (barrier instanceof MockBarrierDriver) {
                barrier.simulateSensorState(state);
                return { success: true, state };
            }

            // For real drivers, inject state manually
            this.handleSensorStateChange(state);
            return { success: true, state };
        });

        // ── Get hardware status ──
        ipcMain.handle('hw:get-status', () => {
            const status = this.registry.getStatus();
            status.lastEventAt = this.lastEventAt;
            status.sensorState = this._sensorState;
            return status;
        });

        // ── Open simulator window ──
        ipcMain.handle('hw:open-simulator', () => {
            this.openSimulatorWindow();
            return { opened: true };
        });

        // ── Open barrier manually ──
        ipcMain.handle('hw:open-barrier', async (_event, type: 'ENTRY' | 'EXIT') => {
            console.log(`[HW-DEBUG] hw:open-barrier called with type=${type}`);
            return safeDriverCall(
                () => this.registry.barrier.openBarrier(type),
                3000,
                false
            );
        });

        // ── Get hardware config ──
        ipcMain.handle('hw:get-config', () => {
            return this.config;
        });

        // ── Get mock mode ──
        ipcMain.handle('hw:get-mock-mode', () => {
            return this.config.mockMode;
        });

        // ── Set mock mode (master switch from Simulator) ──
        ipcMain.handle('hw:set-mock-mode', async (_event, enabled: boolean) => {
            try {
                console.log(`🔀 [HardwareOrchestrator] Mock mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
                this.config.mockMode = enabled;
                saveHardwareConfig(this.config);

                await this.registry.reconfigure(
                    this.getEffectiveConfig(),
                    this.createStatusChangeCallback()
                );

                // Re-wire all events after swap
                this.wireCameraEvents();
                this.wireBarrierEvents();

                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('hw:mock-mode-changed', enabled);
                }
                if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
                    this.simulatorWindow.webContents.send('hw:mock-mode-changed', enabled);
                }

                this.emitStatusToRenderer();
                return { success: true, mockMode: enabled };
            } catch (err: any) {
                console.error('❌ [HardwareOrchestrator] Mock mode change failed:', err);
                return { success: false, error: err.message };
            }
        });

        // ── Set hardware config (hot-swap) ──
        ipcMain.handle('hw:set-config', async (_event, newConfig: HardwareConfig) => {
            try {
                if (!newConfig || !newConfig.barrier || !newConfig.camera) {
                    return { success: false, error: 'Invalid config structure' };
                }

                this.config = {
                    mockMode: newConfig.mockMode ?? this.config.mockMode,
                    barrier: {
                        ...DEFAULT_HARDWARE_CONFIG.barrier,
                        ...newConfig.barrier,
                        ethernet: newConfig.barrier.ethernet
                            ? { ...DEFAULT_HARDWARE_CONFIG.barrier.ethernet, ...newConfig.barrier.ethernet }
                            : this.config.barrier.ethernet,
                    },
                    camera: {
                        ...DEFAULT_HARDWARE_CONFIG.camera,
                        ...newConfig.camera,
                        webhook: newConfig.camera.webhook
                            ? { ...DEFAULT_HARDWARE_CONFIG.camera.webhook, ...newConfig.camera.webhook }
                            : this.config.camera.webhook,
                        hikvision: newConfig.camera.hikvision
                            ? { ...DEFAULT_HARDWARE_CONFIG.camera.hikvision, ...newConfig.camera.hikvision }
                            : this.config.camera.hikvision,
                    },
                    scanner: { ...DEFAULT_HARDWARE_CONFIG.scanner, ...newConfig.scanner },
                    reconnect: { ...DEFAULT_HARDWARE_CONFIG.reconnect, ...newConfig.reconnect },
                };
                console.log(`[HW-DEBUG] Config after merge: barrier.ethernet =`, JSON.stringify(this.config.barrier.ethernet));
                saveHardwareConfig(this.config);

                // Fire-and-forget: reconfigure drivers asynchronously.
                // Driver connection timeouts (e.g. EthernetRelay 10s) must NOT block
                // the IPC response. Status will propagate via onDriverStatusToast.
                const effectiveConfig = this.getEffectiveConfig();
                const statusCallback = this.createStatusChangeCallback();
                (async () => {
                    try {
                        await this.registry.reconfigure(effectiveConfig, statusCallback);
                        this.wireCameraEvents();
                        this.wireBarrierEvents();
                        this.emitStatusToRenderer();
                    } catch (reconfigErr: any) {
                        console.error(
                            `⚠️ [HardwareOrchestrator] Driver reconfigure failed (non-blocking): ${reconfigErr.message}`
                        );
                        // Status indicators will reflect the offline state naturally
                        this.emitStatusToRenderer();
                    }
                })();

                return { success: true, config: this.config };
            } catch (err: any) {
                console.error('❌ [HardwareOrchestrator] Config save failed:', err);
                return { success: false, error: err.message };
            }
        });

        console.log('✅ [HardwareOrchestrator] IPC handlers registered');
    }

    // ── Automated Entry Flow (Button Press → Camera → IPC) ────────

    /**
     * Adapter between the raw ESP32 button press and the full entry pipeline.
     * Attempts an async camera capture with graceful degradation: if the camera
     * is MOCK, fails, or times out, the flow continues with empty photo/plate
     * so vehicle ingress is NEVER blocked by a camera failure.
     */
    private async handleAutomatedEntryFlow(type: 'ENTRY' | 'EXIT'): Promise<void> {
        // Only the ENTRY flow triggers automated ingress
        if (type !== 'ENTRY') {
            console.log(`ℹ️ [HardwareOrchestrator] Button press ${type} — no automated flow for EXIT`);
            return;
        }

        console.log(`🚀 [HardwareOrchestrator] Automated entry flow triggered by physical button`);

        // Lock the event stream so the camera doesn't emit a duplicate event
        this._isAutomatedFlowActive = true;
        this._capturedCameraEvent = null;

        // ── Attempt camera capture (fail-safe, 3s timeout) ──
        let photoPath = '';
        let suggestedPlate = '';

        try {
            const captureResult = await safeDriverCall(
                () => this.registry.camera.triggerCapture(),
                3000,
                '' // Fallback: empty string on timeout/error
            );

            // Wait a tiny tick (50ms) to allow the event loop to process any pending 
            // synchronous event emissions from the driver (like the MockDriver does)
            await new Promise(resolve => setTimeout(resolve, 50));

            // Consolidate: if the camera driver natively emitted an event (Mock or Webhook),
            // we absorb its data. Otherwise, we use the direct captureResult.
            const captured = this._capturedCameraEvent as HardwareEntryEvent | null;
            if (captured) {
                photoPath = captured.photoPath || captureResult;
                suggestedPlate = captured.suggestedPlate || '';
                console.log(`📸 [HardwareOrchestrator] Consolidating async camera event into automated flow`);
            } else if (captureResult) {
                photoPath = captureResult;
            }
        } catch (err: any) {
            console.warn(`⚠️ [HardwareOrchestrator] Camera capture failed (graceful degradation): ${err.message}`);
        } finally {
            // Unlock the stream
            this._isAutomatedFlowActive = false;
        }

        // ── Build the SINGLE Unified HardwareEntryEvent envelope ──
        const event: HardwareEntryEvent = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            photoPath,
            suggestedPlate,
            ocrStatus: suggestedPlate ? 'DETECTED' : 'NOT_FOUND',
            source: 'MANUAL', // Always MANUAL when triggered by the button
        };

        // ── Delegate to the unified entry pipeline ──
        // handleEntryEvent handles: dedup → barrier open → IPC → simulator notify
        this.handleEntryEvent(event);
    }

    // ── Event Handling ───────────────────────────────────────────────

    /**
     * Process an entry event with deduplication.
     * PARADIGM: Hardware detection → auto-open ENTRY barrier → notify frontend.
     * The frontend registration ("Dar Entrada") does NOT open the barrier.
     */
    private handleEntryEvent(event: HardwareEntryEvent): void {
        if (this._recentEventIds.has(event.id)) {
            console.warn(`⚠️ [HardwareOrchestrator] DUPLICATE entry event suppressed: ${event.id}`);
            return;
        }

        this._recentEventIds.add(event.id);
        setTimeout(() => {
            this._recentEventIds.delete(event.id);
        }, this._dedupeWindowMs);

        this.lastEventAt = event.timestamp;
        console.log(`📥 [HardwareOrchestrator] Entry event: plate=${event.suggestedPlate}, source=${event.source}, id=${event.id}`);

        // ── AUTO-OPEN ENTRY BARRIER ──
        // The hardware detected a vehicle → open the physical entry barrier immediately.
        // This replaces the old flow where the frontend's "Dar Entrada" button opened the barrier.
        safeDriverCall(
            () => this.registry.barrier.openBarrier('ENTRY'),
            3000,
            false
        ).then((opened) => {
            console.log(`🔓 [HardwareOrchestrator] Entry barrier auto-open: ${opened ? 'SUCCESS' : 'FAILED'}`);
        });

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('hw:entry-detected', event);
        }
        if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
            this.simulatorWindow.webContents.send('sim:entry-result', {
                success: true,
                plate: event.suggestedPlate,
                eventId: event.id,
            });
        }
    }

    /**
     * Process an RFID scan event from ESP32 or Simulator.
     * Orchestrates: dedup → API check → barrier open → IPC notify.
     */
    private async handleRfidScan(event: RfidScanEvent): Promise<void> {
        // ── Deduplication: same tag within cooldown window ──
        const now = Date.now();
        if (event.rfidCode === this._lastRfidCode && (now - this._lastRfidAt) < this._rfidDedupeMs) {
            console.warn(`⚠️ [HardwareOrchestrator] RFID dedup: ${event.rfidCode} scanned ${now - this._lastRfidAt}ms ago, ignoring`);
            return;
        }
        this._lastRfidCode = event.rfidCode;
        this._lastRfidAt = now;

        console.log(`🏷️ [HardwareOrchestrator] RFID scan received: ${event.rfidCode} (source=${event.source})`);

        // ── Query backend for authorization ──
        let result: RfidAuthResult;
        try {
            result = await checkRfidAuthorizationViaAPI(event.rfidCode);
        } catch (err: any) {
            console.error(`❌ [HardwareOrchestrator] RFID API call failed: ${err.message}`);
            result = { authorized: false, reason: 'ERROR', rfidCode: event.rfidCode, error: err.message };
        }

        console.log(`🏷️ [HardwareOrchestrator] RFID auth result: authorized=${result.authorized}, reason=${result.reason}`);

        // ── If authorized, open exit barrier ──
        if (result.authorized) {
            const opened = await safeDriverCall(
                () => this.registry.barrier.openBarrier('EXIT'),
                3000,
                false
            );
            console.log(`🔓 [HardwareOrchestrator] RFID exit barrier ${opened ? 'OPENED' : 'FAILED TO OPEN'}`);

            // Mark as used (anti-passback)
            if (result.stayId) {
                markBarrierExitUsed(result.stayId);
            }
        }

        // ── Notify frontend ──
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('hw:rfid-auth-result', result);
        }

        // ── Notify simulator ──
        if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
            this.simulatorWindow.webContents.send('sim:rfid-result', result);
        }
    }

    /**
     * Process a sensor state change from ESP32 or Simulator.
     * Updates internal state and propagates to frontend via IPC.
     */
    private handleSensorStateChange(state: SensorOccupancyState): void {
        // Only propagate actual changes (avoid spamming IPC)
        if (state === this._sensorState) return;

        const prevState = this._sensorState;
        this._sensorState = state;

        console.log(`📡 [HardwareOrchestrator] Sensor state: ${prevState} → ${state}`);

        // ── Notify frontend ──
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('hw:sensor-state-changed', {
                state,
                previousState: prevState,
                timestamp: new Date().toISOString(),
            });
        }

        // ── Notify simulator ──
        if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
            this.simulatorWindow.webContents.send('sim:sensor-state', { state });
        }

        // ── Also push full status update (so status polling gets the new state) ──
        this.emitStatusToRenderer();
    }

    private emitStatusToRenderer(): void {
        const status = this.registry.getStatus();
        status.lastEventAt = this.lastEventAt;
        status.sensorState = this._sensorState;

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('hw:status-changed', status);
        }
        // Also propagate to simulator window (for barrier LED tracking)
        if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
            this.simulatorWindow.webContents.send('hw:status-changed', status);
        }
    }

    // ── Simulator Window ─────────────────────────────────────────────

    private openSimulatorWindow(): void {
        console.log('[HW-DEBUG] openSimulatorWindow() called');

        if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
            console.log('[HW-DEBUG] Simulator already open, focusing');
            this.simulatorWindow.focus();
            return;
        }

        let rootDir: string;
        try {
            const { app } = require('electron');
            if (app.isPackaged) {
                rootDir = path.join((process as any).resourcesPath, 'app.asar');
            } else {
                rootDir = process.cwd();
            }
        } catch {
            rootDir = process.cwd();
        }

        const simulatorPath = path.join(rootDir, 'simulator.html');
        const preloadPath = path.join(rootDir, 'SimulatorPreload.js');

        console.log('[HW-DEBUG] Simulator paths:', { rootDir, simulatorPath, preloadPath });
        console.log('[HW-DEBUG] simulator.html exists:', fs.existsSync(simulatorPath));
        console.log('[HW-DEBUG] SimulatorPreload.js exists:', fs.existsSync(preloadPath));

        if (!fs.existsSync(simulatorPath)) {
            console.error('[HW-DEBUG] ❌ simulator.html not found at:', simulatorPath);
            return;
        }

        this.simulatorWindow = new BrowserWindow({
            width: 520,
            height: 750,
            title: 'GarageIA — Hardware Simulator',
            alwaysOnTop: true,
            resizable: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath,
            },
        });

        this.simulatorWindow.setMenuBarVisibility(false);
        this.simulatorWindow.loadFile(simulatorPath);

        this.simulatorWindow.on('closed', () => {
            this.simulatorWindow = null;
        });

        console.log('[HW-DEBUG] 🎮 Simulator window opened successfully');
    }

    // ── Keyboard Shortcut ────────────────────────────────────────────

    private registerSimulatorShortcut(): void {
        if (this._shortcutRegistered) {
            console.log('[HW-DEBUG] Shortcut already registered, skipping');
            return;
        }

        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            console.warn('[HW-DEBUG] ⚠️ registerSimulatorShortcut: mainWindow is null or destroyed — shortcut NOT registered');
            return;
        }

        const accelerator = 'CommandOrControl+Shift+D';
        const registered = globalShortcut.register(accelerator, () => {
            console.log('[HW-DEBUG] 🎹 Ctrl+Shift+D pressed (globalShortcut fired)');

            if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isFocused()) {
                console.log('[HW-DEBUG] mainWindow is focused — opening simulator');
                this.openSimulatorWindow();
            } else if (this.simulatorWindow && !this.simulatorWindow.isDestroyed() && this.simulatorWindow.isFocused()) {
                console.log('[HW-DEBUG] simulatorWindow is focused — focusing simulator');
                this.simulatorWindow.focus();
            } else {
                console.log('[HW-DEBUG] App not focused — ignoring shortcut');
            }
        });

        if (registered) {
            this._shortcutRegistered = true;
            console.log(`[HW-DEBUG] ✅ globalShortcut '${accelerator}' registered successfully`);
        } else {
            console.error(`[HW-DEBUG] ❌ globalShortcut '${accelerator}' registration FAILED (may be taken by another app)`);
        }

        this.mainWindow.on('closed', () => {
            console.log('[HW-DEBUG] mainWindow closed — unregistering globalShortcut');
            globalShortcut.unregister(accelerator);
            this._shortcutRegistered = false;
        });
    }
}
