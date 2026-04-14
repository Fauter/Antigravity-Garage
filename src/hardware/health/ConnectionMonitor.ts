/**
 * ConnectionMonitor.ts — Heartbeat + automatic reconnection for hardware drivers.
 *
 * Polls driver.isConnected() at regular intervals. If the driver drops offline,
 * schedules reconnection with exponential backoff.
 *
 * Emits state changes so the HardwareOrchestrator can propagate to the renderer.
 */

import type { IDriver, ReconnectConfig } from '../HardwareAbstractionLayer';

export type StateChangeCallback = (driverType: string, online: boolean) => void;

export class ConnectionMonitor {
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _attempts = 0;
    private _stopped = false;

    constructor(
        private driver: IDriver,
        private config: ReconnectConfig,
        private onStateChange: StateChangeCallback,
    ) {}

    /**
     * Start monitoring. Call after driver.connect() succeeds.
     */
    start(): void {
        this._stopped = false;
        this._attempts = 0;

        this.heartbeatInterval = setInterval(() => {
            if (this._stopped) return;

            if (!this.driver.isConnected()) {
                console.warn(`⚠️ [Monitor:${this.driver.driverType}] Driver offline, scheduling reconnect`);
                this.onStateChange(this.driver.driverType, false);
                this.scheduleReconnect();
            }
        }, this.config.intervalMs);
    }

    /**
     * Stop monitoring and cancel any pending reconnect.
     */
    stop(): void {
        this._stopped = true;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Schedule a reconnection attempt with exponential backoff.
     */
    private scheduleReconnect(): void {
        if (this._stopped) return;
        if (this.reconnectTimer) return; // Already scheduled
        if (!this.config.enabled) return;
        if (this.config.maxAttempts !== -1 && this._attempts >= this.config.maxAttempts) {
            console.error(`❌ [Monitor:${this.driver.driverType}] Max reconnect attempts (${this.config.maxAttempts}) reached. Giving up.`);
            return;
        }

        const delay = Math.min(
            this.config.intervalMs * Math.pow(this.config.backoffMultiplier, Math.min(this._attempts, 10)),
            60_000, // Cap at 60 seconds
        );

        console.log(`🔄 [Monitor:${this.driver.driverType}] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._attempts + 1})`);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            if (this._stopped) return;

            this._attempts++;

            try {
                await this.driver.connect();
                console.log(`✅ [Monitor:${this.driver.driverType}] Reconnected after ${this._attempts} attempt(s)`);
                this._attempts = 0;
                this.onStateChange(this.driver.driverType, true);
            } catch (err: any) {
                console.warn(`⚠️ [Monitor:${this.driver.driverType}] Reconnect failed: ${err.message}`);
                this.scheduleReconnect(); // Try again
            }
        }, delay);
    }

    /** Current attempt count (for UI display) */
    get attempts(): number {
        return this._attempts;
    }
}
