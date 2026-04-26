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
 *
 * CRITICAL: This module runs in the Electron Main Process.
 * All async operations have timeouts to prevent event-loop blocking.
 */

import { BrowserWindow, ipcMain, globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';

import type { HardwareConfig, HardwareEntryEvent, HardwareStatus, BarrierAuthResult } from './HardwareAbstractionLayer';
import { DEFAULT_HARDWARE_CONFIG } from './HardwareAbstractionLayer';
import { DriverRegistry } from './DriverRegistry';
import { loadHardwareConfig, saveHardwareConfig } from './config/hardware.config';
import { MockCameraDriver } from './drivers/MockCameraDriver';

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
    private registry: DriverRegistry;
    private config: HardwareConfig;
    private isDev = false;
    private lastEventAt: string | null = null;
    private _ipcRegistered = false;
    private _shortcutRegistered = false;

    // ── Deduplication: track recent event IDs to prevent double-processing ──
    private _recentEventIds: Set<string> = new Set();
    private _dedupeWindowMs = 3000; // 3 second window

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
                this.handleEntryEvent(event);
            });
        } catch (err: any) {
            console.warn(`[HW-DEBUG] wireCameraEvents failed (camera may not be initialized): ${err.message}`);
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
                        ? `${driverType === 'ETHERNET_RELAY' ? 'Barreras' : driverType === 'ANPR_WEBHOOK' ? 'Cámara' : driverType} conectado` 
                        : `${driverType === 'ETHERNET_RELAY' ? 'Barreras' : driverType === 'ANPR_WEBHOOK' ? 'Cámara' : driverType} desconectado`,
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

        // ── Step 1: Load persistent config (synchronous, never throws) ──
        this.config = loadHardwareConfig();
        console.log(`[HW-DEBUG] Config loaded: barrier=${this.config.barrier.driver}, camera=${this.config.camera.driver}`);

        // ── Step 2: Register IPC handlers IMMEDIATELY (synchronous) ──
        // This ensures the renderer can call hw:get-config from the very first frame,
        // even while drivers are still connecting asynchronously.
        if (!this._ipcRegistered) {
            this.registerIPCHandlers();
            this._ipcRegistered = true;
            console.log('[HW-DEBUG] IPC handlers registered (before driver init)');
        }

        // ── Step 3: Register keyboard shortcut (synchronous) ──
        this.registerSimulatorShortcut();

        // ── Step 4: Initialize drivers (async, may fail — system stays functional) ──
        // Use effective config (respects mockMode override)
        try {
            await this.registry.initialize(
                this.getEffectiveConfig(),
                this.createStatusChangeCallback()
            );

            // Wire up camera events → forward to renderer
            this.wireCameraEvents();

            const status = this.registry.getStatus();
            console.log(`[HW-DEBUG] Drivers initialized. Driver: ${status.driverType}. Ctrl+Shift+D → Simulator`);
        } catch (err: any) {
            console.error(`[HW-DEBUG] ❌ Driver initialization failed (system continues in degraded mode): ${err.message}`);
            // IPC handlers are already registered, so the frontend will get
            // the config and a default offline status. The system is usable.
        }

        console.log('[HW-DEBUG] ✅ Orchestrator initialization complete');
    }

    // ── IPC Handlers ─────────────────────────────────────────────────

    private registerIPCHandlers(): void {

        // ── Simulate entry (called from Simulator window) ──
        ipcMain.handle('hw:simulate-entry', async () => {
            const camera = this.registry.camera;

            // If mock, use simulateDetection() to generate full event
            if (camera instanceof MockCameraDriver) {
                const event = camera.simulateDetection();
                // handleEntryEvent has deduplication, so even if onPlateDetected
                // fires separately (which it shouldn't for Mock), it won't duplicate.
                this.handleEntryEvent(event);
                return event;
            }

            // For real cameras, trigger a capture
            await safeDriverCall(() => camera.triggerCapture(), 5000, '');
            return { id: 'triggered', timestamp: new Date().toISOString() };
        });

        // ── Barcode scan at exit barrier ──
        ipcMain.handle('hw:simulate-barcode', async (_event, ticketCode: string) => {
            const result = await checkExitAuthorizationViaAPI(ticketCode);

            // If authorized, open the exit barrier
            if (result.authorized) {
                await safeDriverCall(
                    () => this.registry.barrier.openBarrier('EXIT'),
                    3000,
                    false
                );

                // Mark as used (anti-passback)
                if (result.stayId) {
                    markBarrierExitUsed(result.stayId);
                }
            }

            // Emit to simulator window
            if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
                this.simulatorWindow.webContents.send('sim:exit-result', result);
            }

            // Emit to main window for UI updates
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('hw:barrier-auth-result', result);
            }

            return result;
        });

        // ── Get hardware status ──
        ipcMain.handle('hw:get-status', () => {
            const status = this.registry.getStatus();
            status.lastEventAt = this.lastEventAt;
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

                // Hot-swap drivers based on new effective config
                await this.registry.reconfigure(
                    this.getEffectiveConfig(),
                    this.createStatusChangeCallback()
                );

                // Re-wire camera events after swap
                this.wireCameraEvents();

                // Notify main renderer to update config modal lock state
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('hw:mock-mode-changed', enabled);
                }

                // Notify simulator window
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
                // Validate
                if (!newConfig || !newConfig.barrier || !newConfig.camera) {
                    return { success: false, error: 'Invalid config structure' };
                }

                // Deep merge — preserve nested objects (ethernet, webhook)
                this.config = {
                    mockMode: newConfig.mockMode ?? this.config.mockMode,
                    barrier: {
                        ...DEFAULT_HARDWARE_CONFIG.barrier,
                        ...newConfig.barrier,
                        // Deep merge ethernet sub-config
                        ethernet: newConfig.barrier.ethernet
                            ? { ...DEFAULT_HARDWARE_CONFIG.barrier.ethernet, ...newConfig.barrier.ethernet }
                            : this.config.barrier.ethernet,
                    },
                    camera: {
                        ...DEFAULT_HARDWARE_CONFIG.camera,
                        ...newConfig.camera,
                        // Deep merge webhook sub-config
                        webhook: newConfig.camera.webhook
                            ? { ...DEFAULT_HARDWARE_CONFIG.camera.webhook, ...newConfig.camera.webhook }
                            : this.config.camera.webhook,
                    },
                    scanner: { ...DEFAULT_HARDWARE_CONFIG.scanner, ...newConfig.scanner },
                    reconnect: { ...DEFAULT_HARDWARE_CONFIG.reconnect, ...newConfig.reconnect },
                };
                console.log(`[HW-DEBUG] Config after merge: barrier.ethernet =`, JSON.stringify(this.config.barrier.ethernet));
                saveHardwareConfig(this.config);

                // Hot-swap drivers using effective config (respects mockMode)
                await this.registry.reconfigure(
                    this.getEffectiveConfig(),
                    this.createStatusChangeCallback()
                );

                // Re-wire camera events
                this.wireCameraEvents();

                // Emit new status
                this.emitStatusToRenderer();

                return { success: true, config: this.config };
            } catch (err: any) {
                console.error('❌ [HardwareOrchestrator] Config change failed:', err);
                return { success: false, error: err.message };
            }
        });

        console.log('✅ [HardwareOrchestrator] IPC handlers registered');
    }

    // ── Event Handling ───────────────────────────────────────────────

    /**
     * Process an entry event with deduplication.
     * Events with the same ID within a 3-second window are suppressed.
     */
    private handleEntryEvent(event: HardwareEntryEvent): void {
        // ── Deduplication guard ──
        if (this._recentEventIds.has(event.id)) {
            console.warn(`⚠️ [HardwareOrchestrator] DUPLICATE entry event suppressed: ${event.id}`);
            return;
        }

        // Track this event ID and auto-expire after the dedup window
        this._recentEventIds.add(event.id);
        setTimeout(() => {
            this._recentEventIds.delete(event.id);
        }, this._dedupeWindowMs);

        this.lastEventAt = event.timestamp;
        console.log(`📥 [HardwareOrchestrator] Entry event: plate=${event.suggestedPlate}, source=${event.source}, id=${event.id}`);

        // Forward to main renderer (creates PendingEntry tab)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('hw:entry-detected', event);
        }

        // Forward confirmation to simulator window
        if (this.simulatorWindow && !this.simulatorWindow.isDestroyed()) {
            this.simulatorWindow.webContents.send('sim:entry-result', {
                success: true,
                plate: event.suggestedPlate,
                eventId: event.id,
            });
        }
    }

    private emitStatusToRenderer(): void {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            const status = this.registry.getStatus();
            status.lastEventAt = this.lastEventAt;
            this.mainWindow.webContents.send('hw:status-changed', status);
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

        // __dirname in the orchestrator points to src/hardware/ (or dist_main/hardware/)
        // The simulator files are in the project root, so we resolve relative to process.cwd()
        // or relative to the app root when packaged.
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
            height: 640,
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
    // Uses Electron's globalShortcut API for reliability.
    // before-input-event can silently fail if the webContents isn't fully
    // loaded or if multiple listeners race. globalShortcut hooks at the OS
    // level and is guaranteed to fire.

    private registerSimulatorShortcut(): void {
        if (this._shortcutRegistered) {
            console.log('[HW-DEBUG] Shortcut already registered, skipping');
            return;
        }

        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            console.warn('[HW-DEBUG] ⚠️ registerSimulatorShortcut: mainWindow is null or destroyed — shortcut NOT registered');
            return;
        }

        // Register OS-level shortcut
        const accelerator = 'CommandOrControl+Shift+D';
        const registered = globalShortcut.register(accelerator, () => {
            console.log('[HW-DEBUG] 🎹 Ctrl+Shift+D pressed (globalShortcut fired)');

            // Only respond when mainWindow is focused (not when other apps are active)
            if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isFocused()) {
                console.log('[HW-DEBUG] mainWindow is focused — opening simulator');
                this.openSimulatorWindow();
            } else if (this.simulatorWindow && !this.simulatorWindow.isDestroyed() && this.simulatorWindow.isFocused()) {
                // Also allow when simulator itself is focused (toggle behavior)
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

        // Cleanup: unregister when mainWindow closes to prevent dangling shortcuts
        this.mainWindow.on('closed', () => {
            console.log('[HW-DEBUG] mainWindow closed — unregistering globalShortcut');
            globalShortcut.unregister(accelerator);
            this._shortcutRegistered = false;
        });
    }
}
