/**
 * HikvisionISAPIDriver.ts — Real IP camera driver for Hikvision DS-2CV2041G2-IDW.
 *
 * Captures static snapshots via the native ISAPI REST API:
 *   GET http://{host}/ISAPI/Streaming/channels/{channel}/picture
 *
 * Authentication: Hikvision uses HTTP Digest Auth (RFC 7616).
 * The camera responds 401 with a WWW-Authenticate challenge, then the client
 * retries with the computed digest hash. We use @mhoc/axios-digest-auth which
 * handles this transparently.
 *
 * CRITICAL DESIGN:
 *  - 2500ms absolute timeout on all HTTP requests (AbortController + axios timeout).
 *  - All network errors (ECONNREFUSED, ETIMEDOUT, 401) are caught and logged,
 *    returning '' so the vehicle entry flow is NEVER blocked by camera failure.
 *  - connect() performs a lightweight HEAD request to validate credentials.
 *  - triggerCapture() fetches the JPEG snapshot and compresses it via sharp.
 *  - This camera does NOT perform ANPR — onPlateDetected is a no-op.
 *
 * Runs exclusively in the Electron Main Process (Node.js).
 */

import type {
    ICameraDriver,
    DriverHealth,
    HardwareEntryEvent,
    HikvisionISAPIConfig,
} from '../HardwareAbstractionLayer';
import { compressSnapshot } from '../utils/imageCompressor';

// Lazy-load digest auth module (defensive, same pattern as sharp)
let DigestAuth: any = null;
try {
    DigestAuth = require('@mhoc/axios-digest-auth').default || require('@mhoc/axios-digest-auth');
} catch (err: any) {
    console.error(
        `⚠️ [HikvisionISAPIDriver] Failed to load '@mhoc/axios-digest-auth': ${err.message}. ` +
        `Camera driver will NOT function.`
    );
}

/** Absolute timeout for all ISAPI requests (ms) */
const REQUEST_TIMEOUT_MS = 2500;

export class HikvisionISAPIDriver implements ICameraDriver {
    readonly driverType = 'HIKVISION_ISAPI';
    readonly driverName = 'Cámara Hikvision ISAPI';

    private _connected = false;
    private _connectedAt: Date | null = null;
    private _lastError: string | null = null;
    private _lastCapture: string | null = null;
    private _plateCallbacks: ((event: HardwareEntryEvent) => void)[] = [];
    private _digestClient: any = null;
    private _snapshotUrl: string;

    constructor(private config: HikvisionISAPIConfig) {
        const channel = config.channel ?? 101;
        this._snapshotUrl = `http://${config.host}/ISAPI/Streaming/channels/${channel}/picture`;
    }

    /**
     * Validate credentials and reachability via a lightweight request to the ISAPI endpoint.
     * Uses a HEAD-like GET with a short timeout. If the camera responds (even with data),
     * we consider it connected.
     */
    async connect(): Promise<void> {
        if (!DigestAuth) {
            this._lastError = 'Digest auth module not available';
            throw new Error('[HikvisionISAPIDriver] @mhoc/axios-digest-auth not loaded');
        }

        // Guard: reject empty host to prevent useless connections to localhost
        if (!this.config.host || this.config.host.trim() === '') {
            this._lastError = 'IP de cámara no configurada';
            throw new Error('[HikvisionISAPIDriver] IP de cámara no configurada — host vacío');
        }

        this._digestClient = new DigestAuth({
            username: this.config.username,
            password: this.config.password,
        });

        // Health check: attempt a snapshot request with strict timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await this._digestClient.request({
                method: 'GET',
                url: this._snapshotUrl,
                responseType: 'arraybuffer',
                timeout: REQUEST_TIMEOUT_MS,
                signal: controller.signal,
                // Validate that we got image data back
                validateStatus: (status: number) => status === 200,
            });

            if (response.status === 200 && response.data && response.data.length > 0) {
                this._connected = true;
                this._connectedAt = new Date();
                this._lastError = null;
                console.log(
                    `📷 [HikvisionISAPIDriver] Connected to ${this.config.host} ` +
                    `(health check: ${Math.round(response.data.length / 1024)}KB snapshot received)`
                );
            } else {
                throw new Error(`Unexpected response: status=${response.status}, size=${response.data?.length ?? 0}`);
            }
        } catch (err: any) {
            this._connected = false;
            this._lastError = err.message || 'Connection failed';
            console.error(`❌ [HikvisionISAPIDriver] Connect failed: ${this._lastError}`);
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async disconnect(): Promise<void> {
        // HTTP is stateless — nothing to close
        this._connected = false;
        this._connectedAt = null;
        this._digestClient = null;
        console.log('📷 [HikvisionISAPIDriver] Disconnected');
    }

    isConnected(): boolean {
        return this._connected;
    }

    getHealth(): DriverHealth {
        return {
            online: this._connected,
            lastHeartbeat: this._connected ? new Date() : null,
            lastError: this._lastError,
            reconnectAttempts: 0,
            uptimeMs: this._connectedAt ? Date.now() - this._connectedAt.getTime() : 0,
        };
    }

    /**
     * Subscribe to plate detection events.
     * NOTE: This camera does NOT perform ANPR natively — it only captures snapshots.
     * The callback is stored but never fired by this driver.
     */
    onPlateDetected(callback: (event: HardwareEntryEvent) => void): void {
        this._plateCallbacks.push(callback);
    }

    /**
     * Capture a snapshot from the Hikvision camera.
     *
     * Flow: HTTP GET (Digest Auth) → raw JPEG buffer → sharp compression → Base64 data URI
     *
     * CRITICAL: All errors are caught and logged. Returns '' on any failure
     * so the vehicle entry flow continues without being blocked.
     *
     * @returns Compressed Base64 data URI (data:image/jpeg;base64,...) or '' on failure
     */
    async triggerCapture(): Promise<string> {
        // Guard: reject empty host
        if (!this.config.host || this.config.host.trim() === '') {
            console.warn('⚠️ [HikvisionISAPIDriver] triggerCapture aborted — IP de cámara no configurada');
            return '';
        }

        if (!this._digestClient) {
            console.warn('⚠️ [HikvisionISAPIDriver] triggerCapture called but client not initialized');
            return '';
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await this._digestClient.request({
                method: 'GET',
                url: this._snapshotUrl,
                responseType: 'arraybuffer',
                timeout: REQUEST_TIMEOUT_MS,
                signal: controller.signal,
                validateStatus: (status: number) => status === 200,
            });

            if (!response.data || response.data.length === 0) {
                console.warn('⚠️ [HikvisionISAPIDriver] Empty response from camera');
                return '';
            }

            // Convert arraybuffer to Node.js Buffer
            const rawBuffer = Buffer.from(response.data);
            console.log(
                `📸 [HikvisionISAPIDriver] Snapshot captured: ${Math.round(rawBuffer.length / 1024)}KB raw`
            );

            // Compress via sharp pipeline (defensive — falls back internally)
            const compressedBase64 = await compressSnapshot(rawBuffer);

            this._lastCapture = compressedBase64;
            this._lastError = null;
            this._connected = true; // Successful capture confirms connectivity

            return compressedBase64;
        } catch (err: any) {
            // Classify the error for logging but NEVER throw upward
            const errorCode = err.code || '';
            const errorMsg = err.message || 'Unknown error';

            if (errorCode === 'ECONNREFUSED') {
                console.error(`❌ [HikvisionISAPIDriver] Connection refused at ${this.config.host} — camera unreachable`);
            } else if (errorCode === 'ETIMEDOUT' || err.name === 'AbortError' || errorCode === 'ECONNABORTED') {
                console.error(`❌ [HikvisionISAPIDriver] Request timed out (${REQUEST_TIMEOUT_MS}ms) — camera not responding`);
            } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
                console.error(`❌ [HikvisionISAPIDriver] Authentication failed — check username/password`);
            } else {
                console.error(`❌ [HikvisionISAPIDriver] Capture failed: ${errorMsg} (code: ${errorCode})`);
            }

            this._lastError = errorMsg;
            this._connected = false;
            return ''; // Graceful degradation: entry flow continues without photo
        } finally {
            clearTimeout(timeoutId);
        }
    }

    getLastCapture(): string | null {
        return this._lastCapture;
    }
}
