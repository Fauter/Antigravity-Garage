/**
 * EthernetRelayDriver.ts — Controls barriers via TCP/IP relay module.
 *
 * Supports relay modules with simple TCP text protocol (Numato, HW-group, etc).
 * Protocol: send a text command over a raw TCP socket, relay toggles.
 *
 * ZERO native dependencies — uses Node.js built-in `net` module.
 *
 * Connection lifecycle:
 *   connect() → TCP socket to relay module IP:port
 *   openBarrier() → send "relay <channel> on", wait pulseDurationMs, send "relay <channel> off"
 *   disconnect() → close TCP socket
 *
 * If the cable is unplugged, the 'close'/'error' events on the socket trigger
 * reconnection logic via the ConnectionMonitor.
 */

import net from 'net';
import type { IBarrierDriver, DriverHealth, EthernetRelayConfig } from '../HardwareAbstractionLayer';

export class EthernetRelayDriver implements IBarrierDriver {
    readonly driverType = 'ETHERNET_RELAY';
    readonly driverName = 'Barrera Ethernet (Relé TCP)';

    private socket: net.Socket | null = null;
    private _connected = false;
    private _connectedAt: Date | null = null;
    private _lastError: string | null = null;
    private _reconnectAttempts = 0;

    private _buttonCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _vehicleCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];

    // Callback the ConnectionMonitor attaches to get notified of unexpected disconnects
    private _onDisconnect: (() => void) | null = null;

    constructor(private config: EthernetRelayConfig) {}

    async connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.socket = new net.Socket();
            this.socket.setTimeout(5000);

            this.socket.connect(this.config.port, this.config.host, () => {
                this._connected = true;
                this._connectedAt = new Date();
                this._lastError = null;
                this._reconnectAttempts = 0;
                console.log(`🔌 [EthernetRelay] Connected to ${this.config.host}:${this.config.port}`);
                resolve();
            });

            this.socket.on('error', (err) => {
                this._lastError = err.message;
                console.error(`❌ [EthernetRelay] Socket error: ${err.message}`);
                if (!this._connected) {
                    reject(err);
                }
            });

            this.socket.on('close', () => {
                const wasConnected = this._connected;
                this._connected = false;
                console.warn('⚠️ [EthernetRelay] Socket closed');
                if (wasConnected && this._onDisconnect) {
                    this._onDisconnect();
                }
            });

            this.socket.on('timeout', () => {
                this._lastError = 'Connection timeout';
                this.socket?.destroy();
            });
        });
    }

    async disconnect(): Promise<void> {
        this._onDisconnect = null; // Prevent reconnect on intentional disconnect
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this._connected = false;
        this._connectedAt = null;
        console.log('🔌 [EthernetRelay] Disconnected');
    }

    isConnected(): boolean {
        return this._connected;
    }

    getHealth(): DriverHealth {
        return {
            online: this._connected,
            lastHeartbeat: this._connected ? new Date() : null,
            lastError: this._lastError,
            reconnectAttempts: this._reconnectAttempts,
            uptimeMs: this._connectedAt ? Date.now() - this._connectedAt.getTime() : 0,
        };
    }

    /**
     * Set a callback for unexpected disconnects (used by ConnectionMonitor).
     */
    onUnexpectedDisconnect(cb: () => void): void {
        this._onDisconnect = cb;
    }

    async openBarrier(type: 'ENTRY' | 'EXIT'): Promise<boolean> {
        if (!this._connected || !this.socket) {
            console.error('❌ [EthernetRelay] Cannot open barrier: not connected');
            return false;
        }

        const channel = type === 'ENTRY'
            ? this.config.relayEntryChannel
            : this.config.relayExitChannel;

        const pulseDuration = this.config.pulseDurationMs || 1000;

        try {
            // Send "ON" command
            await this.sendCommand(`relay on ${channel}\r\n`);
            console.log(`🔓 [EthernetRelay] Relay ${channel} ON (${type})`);

            // Schedule "OFF" after pulse duration
            setTimeout(() => {
                this.sendCommand(`relay off ${channel}\r\n`).catch(err =>
                    console.error(`⚠️ [EthernetRelay] Error closing relay:`, err)
                );
                console.log(`🔒 [EthernetRelay] Relay ${channel} OFF (pulse ${pulseDuration}ms)`);
            }, pulseDuration);

            return true;
        } catch (err: any) {
            this._lastError = err.message;
            console.error(`❌ [EthernetRelay] openBarrier failed:`, err);
            return false;
        }
    }

    async closeBarrier(_type: 'ENTRY' | 'EXIT'): Promise<boolean> {
        // Most relay-controlled barriers auto-close via mechanical spring/weight.
        // This is a no-op unless the relay module supports a "close" command.
        return true;
    }

    getBarrierState(_type: 'ENTRY' | 'EXIT'): 'OPEN' | 'CLOSED' | 'UNKNOWN' {
        // Without digital input feedback from the barrier, we can't know the state.
        return 'UNKNOWN';
    }

    onButtonPress(callback: (type: 'ENTRY' | 'EXIT') => void): void {
        this._buttonCallbacks.push(callback);
    }

    onVehicleDetected(callback: (type: 'ENTRY' | 'EXIT') => void): void {
        this._vehicleCallbacks.push(callback);
    }

    // ── Internal ─────────────────────────────────────────────────────

    private sendCommand(cmd: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.destroyed) {
                return reject(new Error('Socket not available'));
            }
            this.socket.write(cmd, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /** Track reconnect attempts (called by ConnectionMonitor) */
    incrementReconnectAttempts(): void {
        this._reconnectAttempts++;
    }

    resetReconnectAttempts(): void {
        this._reconnectAttempts = 0;
    }
}
