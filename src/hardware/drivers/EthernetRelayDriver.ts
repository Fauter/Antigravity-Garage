/**
 * EthernetRelayDriver.ts — Controls barriers via TCP/IP relay module.
 *
 * Connects to an ESP32 via raw TCP socket. The connection is PERSISTENT:
 * the socket stays open as long as the driver is alive, and Keep-Alive
 * packets prevent the Wi-Fi stack from dropping it.
 *
 * Protocol (ESP32 → Server, incoming):
 *   RFID:<tag_id>\n       →  RFID card scanned at exit barrier
 *   SENSOR:OCCUPIED\n     →  Anti-crush radar detects object under barrier
 *   SENSOR:CLEAR\n        →  Anti-crush radar confirms clear zone
 *   ACK:*\n               →  Command acknowledgement
 *   BUTTON:ENTRY\n        →  Physical button press on entry barrier
 *   BUTTON:EXIT\n         →  Physical button press on exit barrier
 *
 * Protocol (Server → ESP32, outgoing):
 *   OPEN:ENTRY\n  →  opens entry barrier
 *   OPEN:EXIT\n   →  opens exit barrier
 *
 * TCP STREAM BUFFERING:
 *   TCP is a byte stream, NOT a message protocol. Data chunks may arrive
 *   fragmented ("RFI" + "D:ABC\n") or concatenated ("RFID:A\nSENSOR:CLEAR\n").
 *   We accumulate bytes in a buffer and split on \n to extract complete messages.
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
import type {
    IBarrierDriver,
    DriverHealth,
    EthernetRelayConfig,
    RfidScanEvent,
    SensorOccupancyState,
} from '../HardwareAbstractionLayer';

export class EthernetRelayDriver implements IBarrierDriver {
    readonly driverType = 'ETHERNET_RELAY';
    readonly driverName = 'Barrera Ethernet (Relé TCP)';

    private socket: net.Socket | null = null;
    private _connected = false;
    private _connectedAt: Date | null = null;
    private _lastError: string | null = null;
    private _reconnectAttempts = 0;
    private _intentionalDisconnect = false;

    // ── TCP Stream Buffer ────────────────────────────────────────────
    // Accumulates incoming bytes until a complete \n-delimited message is found.
    private _recvBuffer = '';

    // ── Event Callback Registries ────────────────────────────────────
    private _buttonCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _vehicleCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _rfidCallbacks: ((event: RfidScanEvent) => void)[] = [];
    private _sensorCallbacks: ((state: SensorOccupancyState) => void)[] = [];

    // Callback the ConnectionMonitor attaches to get notified of unexpected disconnects
    private _onDisconnect: (() => void) | null = null;

    constructor(private config: EthernetRelayConfig) { }

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

        // Reset the TCP stream buffer on new connection
        this._recvBuffer = '';
        this._intentionalDisconnect = false;

        console.log(`[TCP-DEBUG] Intentando conectar a ${host}:${port}`);
        console.log(`[TCP-DEBUG] Config completo:`, JSON.stringify(this.config));

        return new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            this.socket = socket;

            // Track whether this promise has been settled (prevent double resolve/reject)
            let settled = false;

            // ── Connection timeout (only for the handshake, NOT idle) ──
            // 10s is generous for Wi-Fi on a local LAN
            const connectTimeout = setTimeout(() => {
                if (!this._connected && !settled) {
                    settled = true;
                    this._lastError = 'Connection timeout (10s)';
                    console.error(`❌ [EthernetRelay] Connection timeout to ${host}:${port}`);
                    this.destroySocket();
                    reject(new Error(this._lastError));
                }
            }, 10_000);

            socket.connect(port, host, () => {
                clearTimeout(connectTimeout);
                if (settled) return; // Timeout already fired
                settled = true;

                this._connected = true;
                this._connectedAt = new Date();
                this._lastError = null;
                this._reconnectAttempts = 0;

                // ── TCP Tuning for ESP32 LwIP resilience ──
                // Keep-Alive: 5s probe interval for fast dead-peer detection.
                // LwIP on ESP32 has limited socket slots — faster detection
                // means the zombie socket gets reaped sooner on the ESP side.
                socket.setKeepAlive(true, 5_000);
                socket.setNoDelay(true); // Disable Nagle for instant command delivery

                // The socket should stay open indefinitely. Keep-Alive handles
                // dead peer detection at the TCP level.
                socket.setTimeout(0);

                console.log(`🔌 [EthernetRelay] Connected to ${host}:${port} (Keep-Alive 5s, NoDelay ON)`);
                resolve();
            });

            // ── Data from ESP32 (buffered stream processing) ──
            socket.on('data', (data) => {
                const bufferData = Buffer.isBuffer(data)
                    ? data
                    : typeof data === 'string'
                        ? Buffer.from(data)
                        : Buffer.from(data as any);
                
                this.onTcpData(bufferData);
            });

            socket.on('error', (err) => {
                clearTimeout(connectTimeout);
                this._lastError = err.message;
                console.error(`❌ [EthernetRelay] Socket error: ${err.message}`);

                if (!settled) {
                    // Error during handshake → reject the connect() promise
                    settled = true;
                    this.destroySocket();
                    reject(err);
                }
                // Post-connect errors: the 'close' event will fire next and
                // handle cleanup + reconnect signaling. We do NOT destroySocket
                // here because 'close' always follows 'error'.
            });

            socket.on('close', (hadError) => {
                clearTimeout(connectTimeout);
                const wasConnected = this._connected;
                this._connected = false;

                // ── CRITICAL: Full socket teardown before reconnect ──
                // Ensures the OS releases the file descriptor and clears all
                // internal listeners. Without this, the next connect() may
                // leak the old socket or hit EADDRINUSE-like contention.
                this.destroySocket();

                if (this._intentionalDisconnect) {
                    console.log('🔌 [EthernetRelay] Socket closed (intentional)');
                    return;
                }

                console.warn(`⚠️ [EthernetRelay] Socket closed unexpectedly (hadError=${hadError}, wasConnected=${wasConnected})`);

                if (wasConnected && this._onDisconnect) {
                    // Signal ConnectionMonitor → triggers reconnect cycle
                    this._onDisconnect();
                }
            });
        });
    }

    async disconnect(): Promise<void> {
        this._intentionalDisconnect = true;
        this._onDisconnect = null; // Prevent reconnect on intentional disconnect
        this.destroySocket();
        this._connected = false;
        this._connectedAt = null;
        this._recvBuffer = '';
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

    onRfidScanned(callback: (event: RfidScanEvent) => void): void {
        this._rfidCallbacks.push(callback);
    }

    onSensorStateChanged(callback: (state: SensorOccupancyState) => void): void {
        this._sensorCallbacks.push(callback);
    }

    // ── TCP Stream Processing ────────────────────────────────────────
    // TCP is a byte stream. Messages may arrive fragmented or concatenated.
    // We buffer and split by \n to extract complete commands.

    /**
     * Handles raw TCP data from ESP32.
     * Accumulates in buffer and processes complete \n-delimited messages.
     */
    private onTcpData(data: Buffer): void {
        this._recvBuffer += data.toString();

        // Guard against unbounded buffer growth (malformed ESP32 firmware)
        if (this._recvBuffer.length > 4096) {
            console.warn('⚠️ [EthernetRelay] TCP buffer overflow (>4KB) — flushing');
            this._recvBuffer = '';
            return;
        }

        // Extract all complete messages (terminated by \n)
        let newlineIdx: number;
        while ((newlineIdx = this._recvBuffer.indexOf('\n')) !== -1) {
            const message = this._recvBuffer.slice(0, newlineIdx).trim();
            this._recvBuffer = this._recvBuffer.slice(newlineIdx + 1);

            if (message.length > 0) {
                this.parseIncomingMessage(message);
            }
        }
    }

    /**
     * Parse a single complete message from the ESP32.
     * Protocol commands: RFID:<id>, SENSOR:OCCUPIED, SENSOR:CLEAR,
     *                    BUTTON:ENTRY, BUTTON:EXIT, ACK:*
     */
    private parseIncomingMessage(msg: string): void {
        console.log(`📨 [EthernetRelay] ESP32 says: "${msg}"`);

        // ── RFID Tag Scanned ──
        if (msg.startsWith('RFID:')) {
            const rfidCode = msg.slice(5).trim();
            if (rfidCode.length === 0) {
                console.warn('⚠️ [EthernetRelay] Empty RFID code received, ignoring');
                return;
            }
            const event: RfidScanEvent = {
                rfidCode: rfidCode.toUpperCase(),
                timestamp: new Date().toISOString(),
                source: 'ESP32',
            };
            console.log(`🏷️ [EthernetRelay] RFID scanned: ${event.rfidCode}`);
            this._rfidCallbacks.forEach(cb => cb(event));
            return;
        }

        // ── Anti-Crush Sensor State ──
        if (msg.startsWith('SENSOR:')) {
            const stateStr = msg.slice(7).trim().toUpperCase();
            if (stateStr === 'OCCUPIED' || stateStr === 'CLEAR') {
                console.log(`📡 [EthernetRelay] Sensor state → ${stateStr}`);
                this._sensorCallbacks.forEach(cb => cb(stateStr as SensorOccupancyState));
            } else {
                console.warn(`⚠️ [EthernetRelay] Unknown sensor state: "${stateStr}"`);
            }
            return;
        }

        // ── Physical Button Press ──
        if (msg.startsWith('BUTTON:')) {
            const btnType = msg.slice(7).trim().toUpperCase();
            if (btnType === 'ENTRY' || btnType === 'EXIT') {
                console.log(`🔘 [EthernetRelay] Button press: ${btnType}`);
                this._buttonCallbacks.forEach(cb => cb(btnType as 'ENTRY' | 'EXIT'));
            }
            return;
        }

        // ── Vehicle Detection ──
        if (msg.startsWith('VEHICLE:')) {
            const vehType = msg.slice(8).trim().toUpperCase();
            if (vehType === 'ENTRY' || vehType === 'EXIT') {
                console.log(`🚗 [EthernetRelay] Vehicle detected: ${vehType}`);
                this._vehicleCallbacks.forEach(cb => cb(vehType as 'ENTRY' | 'EXIT'));
            }
            return;
        }

        // ── Acknowledgements (ACK:OPEN_ENTRY, ACK:OPEN_EXIT, etc.) ──
        if (msg.startsWith('ACK:')) {
            // Logged above, no further action needed
            return;
        }

        // ── Unknown / Heartbeat / Debug messages ──
        // Already logged above via console.log — no action needed
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
