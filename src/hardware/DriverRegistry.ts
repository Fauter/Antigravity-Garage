/**
 * DriverRegistry.ts — Factory + Registry for hardware drivers.
 *
 * Instantiates the correct driver implementation based on HardwareConfig.
 * Supports hot-swap: calling reconfigure() disconnects old drivers and
 * creates new ones without restarting Electron.
 */

import type {
    IBarrierDriver,
    ICameraDriver,
    HardwareConfig,
    HardwareStatus,
} from './HardwareAbstractionLayer';

import { MockBarrierDriver } from './drivers/MockBarrierDriver';
import { MockCameraDriver } from './drivers/MockCameraDriver';
import { EthernetRelayDriver } from './drivers/EthernetRelayDriver';
import { ANPRWebhookDriver } from './drivers/ANPRWebhookDriver';
import { HikvisionISAPIDriver } from './drivers/HikvisionISAPIDriver';
import { ConnectionMonitor, StateChangeCallback } from './health/ConnectionMonitor';

export class DriverRegistry {
    private _barrier: IBarrierDriver | null = null;
    private _camera: ICameraDriver | null = null;
    private _monitors: ConnectionMonitor[] = [];
    private _config: HardwareConfig | null = null;

    /**
     * Initialize all drivers from config. Connects them with error tolerance.
     */
    async initialize(config: HardwareConfig, onStateChange: StateChangeCallback): Promise<void> {
        this._config = config;

        // Create drivers
        this._barrier = this.createBarrierDriver(config);
        this._camera = this.createCameraDriver(config);

        // Connect all with error tolerance (don't crash if one fails)
        const results = await Promise.allSettled([
            this.safeConnect(this._barrier, 'barrier'),
            this.safeConnect(this._camera, 'camera'),
        ]);

        results.forEach((result, i) => {
            const name = ['barrier', 'camera'][i];
            if (result.status === 'rejected') {
                console.error(`❌ [DriverRegistry] Failed to connect ${name}:`, result.reason);
            }
        });

        // Start connection monitors for non-mock drivers
        this.startMonitors(config, onStateChange);

        console.log('✅ [DriverRegistry] All drivers initialized');
    }

    /**
     * Hot-swap: disconnect old drivers, create new ones from updated config.
     */
    async reconfigure(config: HardwareConfig, onStateChange: StateChangeCallback): Promise<void> {
        console.log('🔄 [DriverRegistry] Reconfiguring drivers...');

        // Stop monitors
        this._monitors.forEach(m => m.stop());
        this._monitors = [];

        // Disconnect old drivers
        await Promise.allSettled([
            this._barrier?.disconnect(),
            this._camera?.disconnect(),
        ]);

        // Re-initialize
        await this.initialize(config, onStateChange);
    }

    /**
     * Disconnect and cleanup all drivers.
     */
    async shutdown(): Promise<void> {
        this._monitors.forEach(m => m.stop());
        this._monitors = [];

        await Promise.allSettled([
            this._barrier?.disconnect(),
            this._camera?.disconnect(),
        ]);

        this._barrier = null;
        this._camera = null;
    }

    // ── Accessors ────────────────────────────────────────────────────

    get barrier(): IBarrierDriver {
        if (!this._barrier) throw new Error('Barrier driver not initialized');
        return this._barrier;
    }

    get camera(): ICameraDriver {
        if (!this._camera) throw new Error('Camera driver not initialized');
        return this._camera;
    }

    getStatus(): HardwareStatus {
        const barrierHealth = this._barrier?.getHealth();
        const cameraHealth = this._camera?.getHealth();

        return {
            entryBarrierOnline: barrierHealth?.online ?? false,
            exitBarrierOnline: barrierHealth?.online ?? false,
            cameraOnline: cameraHealth?.online ?? false,
            scannerOnline: true, // Scanner (USB HID) is always "online" since it's keyboard-mode
            driverType: this._barrier?.driverType ?? 'MOCK',
            lastEventAt: null,
            sensorState: 'UNKNOWN',
            entryBarrierState: this._barrier?.getBarrierState('ENTRY') ?? 'UNKNOWN',
            exitBarrierState: this._barrier?.getBarrierState('EXIT') ?? 'UNKNOWN',
        };
    }

    // ── Factory Methods ──────────────────────────────────────────────

    private createBarrierDriver(config: HardwareConfig): IBarrierDriver {
        switch (config.barrier.driver) {
            case 'ETHERNET_RELAY': {
                if (!config.barrier.ethernet) {
                    console.warn('⚠️ [DriverRegistry] ETHERNET_RELAY selected but no ethernet config provided. Falling back to MOCK.');
                    return new MockBarrierDriver();
                }
                console.log(`[TCP-DEBUG] Creando EthernetRelayDriver con config:`, JSON.stringify(config.barrier.ethernet));
                return new EthernetRelayDriver(config.barrier.ethernet);
            }
            default:
                return new MockBarrierDriver();
        }
    }

    private createCameraDriver(config: HardwareConfig): ICameraDriver {
        switch (config.camera.driver) {
            case 'ANPR_WEBHOOK': {
                if (!config.camera.webhook) {
                    console.warn('⚠️ [DriverRegistry] ANPR_WEBHOOK selected but no webhook config provided. Falling back to MOCK.');
                    return new MockCameraDriver();
                }
                return new ANPRWebhookDriver(config.camera.webhook);
            }
            case 'HIKVISION_ISAPI': {
                if (!config.camera.hikvision) {
                    console.warn('⚠️ [DriverRegistry] HIKVISION_ISAPI selected but no hikvision config provided. Falling back to MOCK.');
                    return new MockCameraDriver();
                }
                return new HikvisionISAPIDriver(config.camera.hikvision);
            }
            case 'DISABLED':
                // Return a mock that's never connected
                return new MockCameraDriver();
            default:
                return new MockCameraDriver();
        }
    }

    // ── Internal ─────────────────────────────────────────────────────

    private async safeConnect(driver: { connect(): Promise<void> } | null, name: string): Promise<void> {
        if (!driver) return;
        try {
            await Promise.race([
                driver.connect(),
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error(`Connection timeout for ${name}`)), 10_000)
                ),
            ]);
        } catch (err: any) {
            console.error(`⚠️ [DriverRegistry] ${name} connect failed: ${err.message}`);
            throw err;
        }
    }

    private startMonitors(config: HardwareConfig, onStateChange: StateChangeCallback): void {
        // Only monitor non-mock drivers
        if (this._barrier && this._barrier.driverType !== 'MOCK') {
            const monitor = new ConnectionMonitor(this._barrier, config.reconnect, onStateChange);
            monitor.start();
            this._monitors.push(monitor);

            // If the driver supports disconnect callbacks, wire it up
            if ('onUnexpectedDisconnect' in this._barrier) {
                (this._barrier as any).onUnexpectedDisconnect(() => {
                    onStateChange(this._barrier!.driverType, false);
                });
            }
        }

        if (this._camera && this._camera.driverType !== 'MOCK') {
            const monitor = new ConnectionMonitor(this._camera, config.reconnect, onStateChange);
            monitor.start();
            this._monitors.push(monitor);
        }
    }
}
