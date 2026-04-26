/**
 * EthernetRelayDriver.ts — Controls barriers via TCP/IP relay module.
 *
 * Connects to an ESP32 via raw TCP socket. The connection is PERSISTENT:
 * the socket stays open as long as the driver is alive, and Keep-Alive
 * packets prevent the Wi-Fi stack from dropping it.
 *
 * Protocol (ESP32):
 *   OPEN:ENTRY\n  →  opens entry barrier
 *   OPEN:EXIT\n   →  opens exit barrier
 *
 * ZERO native dependencies — uses Node.js built-in `net` module.
 *
 * Connection lifecycle:
 *   connect()       → TCP socket to ESP32 IP:port (with Keep-Alive)
 *   openBarrier()   → send "OPEN:ENTRY\n" or "OPEN:EXIT\n"
 *   disconnect()    → graceful close of TCP socket
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
    private _intentionalDisconnect = false;

    private _buttonCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _vehicleCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];

    // Callback the ConnectionMonitor attaches to get notified of unexpected disconnects
    private _onDisconnect: (() => void) | null = null;

    constructor(private config: EthernetRelayConfig) {}

    async connect(): Promise<void> {
        const host = this.config?.host;
        const port = this.config?.port;

        // ── Guard: Validate host & port BEFORE calling socket.connect ──
        if (!host || !port) {
            const msg = `[EthernetRelay] FATAL: host=${host}, port=${port} — cannot connect with undefined parameters. Check config.barrier.ethernet in HardwareConfig.`;
            console.error(`❌ ${msg}`);
            this._lastError = msg;
            throw new Error(msg);
        }

        // Clean up any pre-existing socket (prevents listener leaks on reconnect)
        this.destroySocket();

        this._intentionalDisconnect = false;

        console.log(`[TCP-DEBUG] Intentando conectar a ${host}:${port}`);
        console.log(`[TCP-DEBUG] Config completo:`, JSON.stringify(this.config));

        return new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            this.socket = socket;

            // ── Connection timeout (only for the handshake, NOT idle) ──
            // 10s is generous for Wi-Fi on a local LAN
            const connectTimeout = setTimeout(() => {
                if (!this._connected) {
                    this._lastError = 'Connection timeout (10s)';
                    console.error(`❌ [EthernetRelay] Connection timeout to ${host}:${port}`);
                    socket.destroy();
                    reject(new Error(this._lastError));
                }
            }, 10_000);

            socket.connect(port, host, () => {
                clearTimeout(connectTimeout);

                this._connected = true;
                this._connectedAt = new Date();
                this._lastError = null;
                this._reconnectAttempts = 0;

                // ── Enable TCP Keep-Alive ──
                // This sends periodic probes to keep the connection alive
                // and detect dead peers (ESP32 power loss, Wi-Fi drop, etc.)
                socket.setKeepAlive(true, 15_000); // Probe every 15s
                socket.setNoDelay(true); // Disable Nagle for instant command delivery

                // ── Remove the idle timeout ──
                // The socket should stay open indefinitely. Keep-Alive handles
                // dead peer detection. A blanket setTimeout destroys healthy
                // idle connections — that was the root cause of the flapping.
                socket.setTimeout(0);

                console.log(`🔌 [EthernetRelay] Connected to ${host}:${port} (Keep-Alive ON)`);
                resolve();
            });

            // ── Data from ESP32 (ACK, heartbeat, etc.) ──
            socket.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) {
                    console.log(`📨 [EthernetRelay] ESP32 says: "${msg}"`);
                }
            });

            socket.on('error', (err) => {
                clearTimeout(connectTimeout);
                this._lastError = err.message;
                console.error(`❌ [EthernetRelay] Socket error: ${err.message}`);
                if (!this._connected) {
                    reject(err);
                }
            });

            socket.on('close', (hadError) => {
                clearTimeout(connectTimeout);
                const wasConnected = this._connected;
                this._connected = false;

                if (this._intentionalDisconnect) {
                    console.log('🔌 [EthernetRelay] Socket closed (intentional)');
                    return;
                }

                console.warn(`⚠️ [EthernetRelay] Socket closed unexpectedly (hadError=${hadError})`);
                if (wasConnected && this._onDisconnect) {
                    this._onDisconnect();
                }
            });

            // NOTE: We do NOT set socket.setTimeout() here. 
            // The old 5s timeout was destroying the socket after 5s of idle,
            // which is *normal* between barrier commands. Keep-Alive handles
            // dead-peer detection at the TCP level.
        });
    }

    async disconnect(): Promise<void> {
        this._intentionalDisconnect = true;
        this._onDisconnect = null; // Prevent reconnect on intentional disconnect
        this.destroySocket();
        this._connected = false;
        this._connectedAt = null;
        console.log('🔌 [EthernetRelay] Disconnected');
    }

    isConnected(): boolean {
        return this._connected && this.socket !== null && !this.socket.destroyed;
    }

    getHealth(): DriverHealth {
        return {
            online: this.isConnected(),
            lastHeartbeat: this.isConnected() ? new Date() : null,
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
        if (!this.isConnected() || !this.socket) {
            console.error('❌ [EthernetRelay] Cannot open barrier: not connected');
            return false;
        }

        // ESP32 protocol: send "OPEN:ENTRY\n" or "OPEN:EXIT\n"
        const command = `OPEN:${type}\n`;

        try {
            console.log(`[TCP-DEBUG] Enviando comando: ${JSON.stringify(command)}`);
            await this.sendCommand(command);
            console.log(`🔓 [EthernetRelay] Barrier ${type} OPEN command sent`);
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

    /**
     * Safely destroy the socket and remove all listeners to prevent leaks.
     */
    private destroySocket(): void {
        if (this.socket) {
            this.socket.removeAllListeners();
            if (!this.socket.destroyed) {
                this.socket.destroy();
            }
            this.socket = null;
        }
    }

    /** Track reconnect attempts (called by ConnectionMonitor) */
    incrementReconnectAttempts(): void {
        this._reconnectAttempts++;
    }

    resetReconnectAttempts(): void {
        this._reconnectAttempts = 0;
    }
}
