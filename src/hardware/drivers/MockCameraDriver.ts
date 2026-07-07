/**
 * MockCameraDriver.ts — Simulated ANPR camera for development.
 *
 * Does not produce events on its own. The simulator triggers entries
 * via the orchestrator which calls triggerCapture().
 */

import { v4 as uuidv4 } from 'uuid';
import type { ICameraDriver, DriverHealth, HardwareEntryEvent } from '../HardwareAbstractionLayer';
import { randomPlate, generatePlaceholderPhoto } from './MockBarrierDriver';
import fs from 'fs';
import path from 'path';

export class MockCameraDriver implements ICameraDriver {
    readonly driverType = 'MOCK';
    readonly driverName = 'Simulador de Cámara ANPR';

    private _connected = false;
    private _connectedAt: Date | null = null;
    private _lastCapture: string | null = null;
    private _plateCallbacks: ((event: HardwareEntryEvent) => void)[] = [];

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

    /**
     * Intenta cargar la imagen local de prueba y la convierte a Base64.
     * Retorna fallback (placeholder) en caso de fallo para degradación elegante.
     */
    private _capturePhoto(): string {
        try {
            const imagePath = path.resolve(process.cwd(), '.data/mock/vehiculo_test.jpg');
            if (fs.existsSync(imagePath)) {
                const imageBuffer = fs.readFileSync(imagePath);
                return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
            }
        } catch (error) {
            console.warn('⚠️ [MockCameraDriver] Error leyendo imagen local, usando fallback.', error);
        }
        return generatePlaceholderPhoto(); // Fallback si no existe
    }

    async triggerCapture(): Promise<string> {
        const photoPath = this._capturePhoto();
        this._lastCapture = photoPath;

        const event: HardwareEntryEvent = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            photoPath, // Ahora contiene el Base64
            suggestedPlate: randomPlate(),
            source: 'SIMULATOR',
        };

        // Notify listeners
        this._plateCallbacks.forEach(cb => cb(event));
        return photoPath;
    }

    getLastCapture(): string | null {
        return this._lastCapture;
    }

    /**
     * Manually emit a plate detection event (used by simulator).
     * Returns the generated event for IPC forwarding.
     */
    simulateDetection(): HardwareEntryEvent {
        const photoPath = this._capturePhoto();
        this._lastCapture = photoPath;

        const event: HardwareEntryEvent = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            photoPath,
            suggestedPlate: randomPlate(),
            source: 'SIMULATOR',
        };

        // NOTE: Do NOT fire _plateCallbacks here.
        // The Orchestrator calls handleEntryEvent(event) directly for simulate-entry.
        // Firing callbacks here would cause a DUPLICATE entry (one from callback,
        // one from the direct handleEntryEvent call).
        return event;
    }
}
