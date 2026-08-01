import { v4 as uuidv4 } from 'uuid';
import type { ICameraDriver, DriverHealth, HardwareEntryEvent } from '../HardwareAbstractionLayer';
import { FastAlprClient } from '../alpr/FastAlprClient';
import fs from 'fs';
import path from 'path';

export class MockCameraDriver implements ICameraDriver {
    readonly driverType = 'MOCK';
    readonly driverName = 'Simulador de Cámara ANPR';

    private _connected = false;
    private _connectedAt: Date | null = null;
    private _lastCapture: string | null = null;
    private _plateCallbacks: ((event: HardwareEntryEvent) => void)[] = [];
    private alprClient: FastAlprClient;

    constructor() {
        this.alprClient = new FastAlprClient({
            serviceUrl: 'http://127.0.0.1:8100', // Default local service
            timeoutMs: 3000
        });
    }

    async connect(): Promise<void> {
        this._connected = true;
        this._connectedAt = new Date();
        console.log('🎮 [MockCameraDriver] Connected (simulated)');
    }

    async disconnect(): Promise<void> {
        this._connected = false;
        this._connectedAt = null;
    }

    isConnected(): boolean {
        return this._connected;
    }

    getHealth(): DriverHealth {
        return {
            online: this._connected,
            lastHeartbeat: this._connected ? new Date() : null,
            lastError: null,
            reconnectAttempts: 0,
            uptimeMs: this._connectedAt ? Date.now() - this._connectedAt.getTime() : 0,
        };
    }

    onPlateDetected(callback: (event: HardwareEntryEvent) => void): void {
        this._plateCallbacks.push(callback);
    }

    async triggerCapture(): Promise<string> {
        const eventId = uuidv4();
        const event = await this.simulateDetectionInternal(eventId);
        this._plateCallbacks.forEach(cb => cb(event));
        return event.photoPath;
    }

    getLastCapture(): string | null {
        return this._lastCapture;
    }

    /**
     * Manually emit a plate detection event (used by simulator).
     */
    async simulateDetection(): Promise<HardwareEntryEvent> {
        return this.simulateDetectionInternal(uuidv4());
    }

    private async simulateDetectionInternal(eventId: string): Promise<HardwareEntryEvent> {
        let imageBuffer: Buffer;
        let mimeType: string = 'image/jpeg';
        let base64Image = '';

        const imagePath = path.resolve(process.cwd(), '.data/mock/vehiculo_test.jpg');

        if (!fs.existsSync(imagePath)) {
            console.warn(`⚠️ [MockCameraDriver] Imagen mock no encontrada en: ${imagePath}`);
            const event: HardwareEntryEvent = {
                id: eventId,
                timestamp: new Date().toISOString(),
                photoPath: '',
                suggestedPlate: '',
                ocrStatus: 'ERROR',
                ocrMessage: 'No se encontró la imagen mock',
                ocrProcessingTimeMs: 0,
                source: 'SIMULATOR',
            };
            return event;
        }

        let photoPath = '';
        try {
            imageBuffer = fs.readFileSync(imagePath);
            
            const dir = path.join(process.cwd(), '.data', 'captures');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            const filename = `${eventId}.webp`;
            const filePath = path.join(dir, filename);
            
            const sharp = require('sharp');
            await sharp(imageBuffer)
                .resize({ width: 1280, withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(filePath);
                
            photoPath = `garagemedia://captures/${filename}`;
        } catch (error: any) {
            console.error(`❌ [MockCameraDriver] Error al leer o procesar la imagen mock:`, error);
            const event: HardwareEntryEvent = {
                id: eventId,
                timestamp: new Date().toISOString(),
                photoPath: '',
                suggestedPlate: '',
                ocrStatus: 'ERROR',
                ocrMessage: 'No se pudo leer/procesar la imagen mock',
                ocrProcessingTimeMs: 0,
                source: 'SIMULATOR',
            };
            return event;
        }

        this._lastCapture = photoPath;

        // Call ALPR
        const alprResult = await this.alprClient.recognize({
            eventId,
            imageBuffer,
            mimeType: 'image/jpeg'
        });

        const event: HardwareEntryEvent = {
            id: eventId,
            timestamp: new Date().toISOString(),
            photoPath: photoPath,
            suggestedPlate: alprResult.plate || '',
            ocrStatus: alprResult.status,
            ocrConfidence: alprResult.confidence,
            ocrMessage: alprResult.message,
            ocrProcessingTimeMs: alprResult.processingTimeMs,
            source: 'SIMULATOR',
        };

        return event;
    }
}
