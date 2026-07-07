/**
 * EthernetRelayDriver.ts — Controls barriers via TCP/IP to ESP32.
 *
 * Connects to an ESP32 via raw TCP socket on port 23. The connection is
 * PERSISTENT: the socket stays open as long as the driver is alive, and
 * Keep-Alive packets prevent the Wi-Fi stack from dropping it.
 *
 * Protocol (ESP32 → App, incoming — JSON delimited by \n):
 *   {"event":"BUTTON_PRESSED","payload":"ENTRY_STATION"}   →  Physical button press
 *   {"event":"SENSOR_STATE","payload":"OCCUPIED"}           →  Beam sensor blocked
 *   {"event":"SENSOR_STATE","payload":"CLEAR"}              →  Beam sensor clear
 *   {"event":"BARRIER_STATE","payload":"OPENING"}           →  Barrier arm rising
 *   {"event":"BARRIER_STATE","payload":"OPEN"}              →  Barrier arm fully open
 *   {"event":"BARRIER_STATE","payload":"CLOSING"}           →  Barrier arm descending
 *   {"event":"BARRIER_STATE","payload":"CLOSED"}            →  Barrier arm fully closed
 *   {"event":"BARRIER_STATE","payload":"STOPPED"}           →  Emergency stop engaged
 *   {"event":"RFID","payload":"<tag_uid>"}                  →  RFID tag scanned (future)
 *
 * Protocol (App → ESP32, outgoing — plain text delimited by \n):
 *   OPEN_BARRIER\n    →  Activate relay UP (opens barrier arm)
 *   CLOSE_BARRIER\n   →  Activate relay DOWN (closes barrier arm)
 *   STOP_BARRIER\n    →  Emergency stop (pulses STOP relay)
 *
 * TCP STREAM BUFFERING:
 *   TCP is a byte stream, NOT a message protocol. Data chunks may arrive
 *   fragmented ("{"ev" + "ent":"BU...\n") or concatenated (two JSON objects
 *   in one chunk). We accumulate bytes in a buffer and split on \n to
 *   extract complete messages before JSON.parse.
 *
 * ZERO native dependencies — uses Node.js built-in `net` module.
 *
 * Connection lifecycle:
 *   connect()       → TCP socket to ESP32 IP:port (with Keep-Alive)
 *   openBarrier()   → send "OPEN_BARRIER\n"
 *   closeBarrier()  → send "CLOSE_BARRIER\n"
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

// ── ESP32 JSON Event Shape ──────────────────────────────────────────
// Every message from the firmware follows this structure.

interface Esp32JsonEvent {
    event: string;
    payload: string;
}

// ── Barrier State Type ──────────────────────────────────────────────
// States reported by the firmware's state machine.

type Esp32BarrierState = 'OPENING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'STOPPED';

export class EthernetRelayDriver implements IBarrierDriver {
    readonly driverType = 'ETHERNET_RELAY';
    readonly driverName = 'Barrera Ethernet (ESP32 JSON/TCP)';

    private socket: net.Socket | null = null;
    private _connected = false;
    private _connectedAt: Date | null = null;
    private _lastError: string | null = null;
    private _reconnectAttempts = 0;
    private _intentionalDisconnect = false;

    // ── TCP Stream Buffer ────────────────────────────────────────────
    // Accumulates incoming bytes until a complete \n-delimited message is found.
    private _recvBuffer = '';

    // ── Barrier State Tracking ───────────────────────────────────────
    // The ESP32 controls a single physical barrier. We track state per
    // logical type (ENTRY/EXIT) for interface compliance. Since both map
    // to the same ESP32, they share the same physical state.
    private _barrierStates: Record<'ENTRY' | 'EXIT', 'OPEN' | 'CLOSED' | 'UNKNOWN'> = {
        ENTRY: 'UNKNOWN',
        EXIT: 'UNKNOWN',
    };

    // ── Event Callback Registries ────────────────────────────────────
    private _buttonCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _vehicleCallbacks: ((type: 'ENTRY' | 'EXIT') => void)[] = [];
    private _rfidCallbacks: ((event: RfidScanEvent) => void)[] = [];
    private _sensorCallbacks: ((state: SensorOccupancyState) => void)[] = [];
    private _barrierStateCallbacks: ((type: 'ENTRY' | 'EXIT', state: 'OPEN' | 'CLOSED') => void)[] = [];

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

    // ── Outgoing Commands ────────────────────────────────────────────

    async openBarrier(_type: 'ENTRY' | 'EXIT'): Promise<boolean> {
        if (!this.isConnected() || !this.socket) {
            console.error('❌ [EthernetRelay] Cannot open barrier: not connected');
            return false;
        }

        // ESP32 firmware: single unified barrier controlled by OPEN_BARRIER
        const command = 'OPEN_BARRIER\n';

        try {
            console.log(`[TCP-DEBUG] Enviando comando: ${JSON.stringify(command)}`);
            await this.sendCommand(command);
            console.log(`🔓 [EthernetRelay] OPEN_BARRIER command sent`);
            return true;
        } catch (err: any) {
            this._lastError = err.message;
            console.error(`❌ [EthernetRelay] openBarrier failed:`, err);
            return false;
        }
    }

    async closeBarrier(_type: 'ENTRY' | 'EXIT'): Promise<boolean> {
        if (!this.isConnected() || !this.socket) {
            console.error('❌ [EthernetRelay] Cannot close barrier: not connected');
            return false;
        }

        const command = 'CLOSE_BARRIER\n';

        try {
            console.log(`[TCP-DEBUG] Enviando comando: ${JSON.stringify(command)}`);
            await this.sendCommand(command);
            console.log(`🔒 [EthernetRelay] CLOSE_BARRIER command sent`);
            return true;
        } catch (err: any) {
            this._lastError = err.message;
            console.error(`❌ [EthernetRelay] closeBarrier failed:`, err);
            return false;
        }
    }

    getBarrierState(type: 'ENTRY' | 'EXIT'): 'OPEN' | 'CLOSED' | 'UNKNOWN' {
        return this._barrierStates[type];
    }

    // ── Event Subscriptions ──────────────────────────────────────────

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

    /**
     * Subscribe to barrier arm state changes reported by the ESP32 firmware.
     * Fires when the barrier transitions to a terminal state (OPEN or CLOSED).
     */
    onBarrierStateChanged(callback: (type: 'ENTRY' | 'EXIT', state: 'OPEN' | 'CLOSED') => void): void {
        this._barrierStateCallbacks.push(callback);
    }

    // ── TCP Stream Processing ────────────────────────────────────────
    // TCP is a byte stream. Messages may arrive fragmented or concatenated.
    // We buffer and split by \n to extract complete JSON messages.

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
     * Parse a single complete JSON message from the ESP32.
     * Expected shape: {"event":"<TYPE>","payload":"<VALUE>"}
     */
    private parseIncomingMessage(msg: string): void {
        console.log(`📨 [EthernetRelay] ESP32 says: "${msg}"`);

        let parsed: Esp32JsonEvent;
        try {
            parsed = JSON.parse(msg);
        } catch {
            // Non-JSON message (e.g. boot log, debug print from Serial)
            console.warn(`⚠️ [EthernetRelay] Non-JSON message ignored: "${msg}"`);
            return;
        }

        if (!parsed.event) {
            console.warn(`⚠️ [EthernetRelay] JSON message missing "event" field: "${msg}"`);
            return;
        }

        switch (parsed.event) {
            // ── Physical Button Press ──
            case 'BUTTON_PRESSED': {
                const mappedType = this.mapPayloadToBarrierType(parsed.payload);
                if (mappedType) {
                    console.log(`🔘 [EthernetRelay] Button press: ${mappedType} (payload="${parsed.payload}")`);
                    this._buttonCallbacks.forEach(cb => cb(mappedType));
                } else {
                    console.warn(`⚠️ [EthernetRelay] Unknown BUTTON_PRESSED payload: "${parsed.payload}"`);
                }
                break;
            }

            // ── Anti-Crush / Beam Sensor State ──
            case 'SENSOR_STATE': {
                const state = parsed.payload?.toUpperCase();
                if (state === 'OCCUPIED' || state === 'CLEAR') {
                    console.log(`📡 [EthernetRelay] Sensor state → ${state}`);
                    this._sensorCallbacks.forEach(cb => cb(state as SensorOccupancyState));
                } else {
                    console.warn(`⚠️ [EthernetRelay] Unknown SENSOR_STATE payload: "${parsed.payload}"`);
                }
                break;
            }

            // ── Barrier Arm State Machine ──
            case 'BARRIER_STATE': {
                const barrierState = parsed.payload?.toUpperCase() as Esp32BarrierState;
                console.log(`🚧 [EthernetRelay] Barrier state → ${barrierState}`);
                this.handleBarrierStateUpdate(barrierState);
                break;
            }

            // ── RFID Tag Scanned (future firmware support) ──
            case 'RFID': {
                const rfidCode = parsed.payload?.trim();
                if (!rfidCode || rfidCode.length === 0) {
                    console.warn('⚠️ [EthernetRelay] Empty RFID payload received, ignoring');
                    break;
                }
                const event: RfidScanEvent = {
                    rfidCode: rfidCode.toUpperCase(),
                    timestamp: new Date().toISOString(),
                    source: 'ESP32',
                };
                console.log(`🏷️ [EthernetRelay] RFID scanned: ${event.rfidCode}`);
                this._rfidCallbacks.forEach(cb => cb(event));
                break;
            }

            // ── Unknown Event ──
            default: {
                console.log(`ℹ️ [EthernetRelay] Unhandled event type: "${parsed.event}" (payload="${parsed.payload}")`);
                break;
            }
        }
    }

    // ── Internal Helpers ─────────────────────────────────────────────

    /**
     * Maps ESP32 BUTTON_PRESSED payload values to the IBarrierDriver type.
     * The firmware sends "ENTRY_STATION"; future firmware may send "EXIT_STATION".
     */
    private mapPayloadToBarrierType(payload: string): 'ENTRY' | 'EXIT' | null {
        switch (payload?.toUpperCase()) {
            case 'ENTRY_STATION':
                return 'ENTRY';
            case 'EXIT_STATION':
                return 'EXIT';
            default:
                return null;
        }
    }

    /**
     * Updates internal barrier state tracking from firmware telemetry.
     * Maps transient states (OPENING/CLOSING) to terminal states (OPEN/CLOSED)
     * and fires callbacks when a terminal state is reached.
     */
    private handleBarrierStateUpdate(state: Esp32BarrierState): void {
        let terminalState: 'OPEN' | 'CLOSED' | null = null;

        switch (state) {
            case 'OPEN':
                terminalState = 'OPEN';
                break;
            case 'CLOSED':
                terminalState = 'CLOSED';
                break;
            case 'STOPPED':
                // STOPPED is an intermediate state — barrier position is ambiguous.
                // We do NOT update _barrierStates to avoid stale reads.
                // The next OPEN/CLOSED from the firmware will correct it.
                break;
            case 'OPENING':
            case 'CLOSING':
                // Transient states — logged but no terminal state update.
                break;
        }

        if (terminalState) {
            // Single ESP32 → both logical types share the same physical state
            this._barrierStates.ENTRY = terminalState;
            this._barrierStates.EXIT = terminalState;
            this._barrierStateCallbacks.forEach(cb => {
                cb('ENTRY', terminalState!);
                cb('EXIT', terminalState!);
            });
        }
    }

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
