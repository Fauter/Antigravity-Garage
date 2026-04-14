/**
 * HardwareAbstractionLayer.ts — HAL 2.0
 * 
 * Interfaces agnósticas de protocolo para barreras y cámaras ANPR.
 * En Fase 1, solo se implementa MockHardwareDriver.
 * En fases futuras, JomafBarrierDriver y AnprCameraDriver implementarán
 * estas interfaces con protocolos reales (TCP/IP, Serial, etc).
 */

// ── Event Types ──────────────────────────────────────────────────────

/** Evento emitido cuando el hardware detecta un ingreso */
export interface HardwareEntryEvent {
    id: string;                 // UUID del evento
    timestamp: Date;
    photoPath: string;          // Ruta absoluta a la foto capturada
    suggestedPlate: string;     // OCR de la cámara (vacío si no soporta)
    source: 'ANPR' | 'MANUAL' | 'SIMULATOR';
}

/** Query de autorización de salida por barcode */
export interface BarrierAuthQuery {
    ticketCode: string;
    timestamp: Date;
}

/** Resultado de la autorización de salida */
export interface BarrierAuthResult {
    authorized: boolean;
    reason: 'PAID' | 'SUBSCRIBER' | 'NOT_FOUND' | 'NOT_PAID' | 'ALREADY_USED';
    stayId?: string;
    plate?: string;
}

// ── Driver Contracts ─────────────────────────────────────────────────

/** Contrato para drivers de barrera (JOMAF u otros) */
export interface IBarrierDriver {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    openBarrier(type: 'ENTRY' | 'EXIT'): Promise<boolean>;
    isConnected(): boolean;
    onButtonPress(callback: () => void): void;
    onBarcodeScanned(callback: (code: string) => void): void;
}

/** Contrato para drivers de cámara ANPR */
export interface ICameraDriver {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    onCapture(callback: (event: HardwareEntryEvent) => void): void;
    triggerCapture(): Promise<string>;  // Returns photo path
    isConnected(): boolean;
}

/** Estado global del hardware */
export interface HardwareStatus {
    entryBarrierOnline: boolean;
    exitBarrierOnline: boolean;
    cameraOnline: boolean;
    driverType: 'MOCK' | 'JOMAF' | 'GENERIC';
    lastEventAt: Date | null;
}
