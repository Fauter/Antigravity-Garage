/**
 * ANPRWebhookDriver.ts — Receives plate detection events via HTTP webhook.
 *
 * Instead of processing RTSP streams in the Main Process (which would block
 * the event loop and require heavy native deps like OpenCV), this driver
 * acts as an HTTP listener. The ANPR source (smart camera or Plate Recognizer
 * Docker) sends a POST with plate data when a vehicle is detected.
 *
 * ZERO native dependencies — uses Node.js built-in `http` module + express
 * (already a project dependency).
 */

import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import type { ICameraDriver, DriverHealth, HardwareEntryEvent, ANPRWebhookConfig } from '../HardwareAbstractionLayer';

export class ANPRWebhookDriver implements ICameraDriver {
    readonly driverType = 'ANPR_WEBHOOK';
    readonly driverName = 'Cámara ANPR (Webhook)';

    private server: http.Server | null = null;
    private _connected = false;
    private _connectedAt: Date | null = null;
    private _lastError: string | null = null;
    private _lastCapture: string | null = null;
    private _plateCallbacks: ((event: HardwareEntryEvent) => void)[] = [];

    constructor(private config: ANPRWebhookConfig) {}

    async connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                // Only accept POST to /anpr-event
                if (req.method !== 'POST' || req.url !== '/anpr-event') {
                    res.writeHead(404);
                    res.end('Not Found');
                    return;
                }

                // Auth check
                if (this.config.authToken && req.headers['x-auth-token'] !== this.config.authToken) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }

                let body = '';
                req.on('data', (chunk) => { body += chunk; });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        const event: HardwareEntryEvent = {
                            id: uuidv4(),
                            timestamp: new Date().toISOString(),
                            photoPath: data.photo_url || data.photoPath || '',
                            suggestedPlate: (data.plate || data.plateNumber || data.results?.[0]?.plate || '').toUpperCase(),
                            source: 'ANPR',
                        };

                        this._lastCapture = event.photoPath;
                        this._plateCallbacks.forEach(cb => cb(event));

                        console.log(`📷 [ANPRWebhook] Plate detected: ${event.suggestedPlate}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ received: true, eventId: event.id }));
                    } catch (err: any) {
                        console.error('❌ [ANPRWebhook] Invalid payload:', err.message);
                        res.writeHead(400);
                        res.end('Invalid JSON');
                    }
                });
            });

            this.server.on('error', (err: any) => {
                this._lastError = err.message;
                if (err.code === 'EADDRINUSE') {
                    console.error(`❌ [ANPRWebhook] Port ${this.config.listenPort} already in use`);
                }
                if (!this._connected) reject(err);
            });

            this.server.listen(this.config.listenPort, () => {
                this._connected = true;
                this._connectedAt = new Date();
                this._lastError = null;
                console.log(`📷 [ANPRWebhook] Listening on port ${this.config.listenPort}`);
                resolve();
            });
        });
    }

    async disconnect(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this._connected = false;
                    this._connectedAt = null;
                    console.log('📷 [ANPRWebhook] Server closed');
                    resolve();
                });
                this.server = null;
            } else {
                resolve();
            }
        });
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

    onPlateDetected(callback: (event: HardwareEntryEvent) => void): void {
        this._plateCallbacks.push(callback);
    }

    async triggerCapture(): Promise<string> {
        // Webhook cameras don't support manual trigger — they push events
        console.warn('⚠️ [ANPRWebhook] triggerCapture() not supported in webhook mode');
        return '';
    }

    getLastCapture(): string | null {
        return this._lastCapture;
    }
}
