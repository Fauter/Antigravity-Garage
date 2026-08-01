/**
 * HardwareAbstractionLayer.ts — HAL 3.0 (Strategy Pattern)
 *
 * Interfaces agnósticas de protocolo para barreras, cámaras ANPR y scanners.
 * Cada interfaz define un contrato que los Drivers (Mock, Ethernet, Serial)
 * deben cumplir. El DriverRegistry instancia el driver correcto según config.
 *
 * Principio clave: NINGÚN driver accede a NeDB directamente.
 * La lógica de negocio (exit authorization) se delega al backend via HTTP.
 */

// ── Event Types ──────────────────────────────────────────────────────

export type OcrStatus = 'DETECTED' | 'NOT_FOUND' | 'ERROR';

/** Evento emitido cuando el hardware detecta un ingreso */
export interface HardwareEntryEvent {
    id: string;                 // UUID del evento
    timestamp: string;          // ISO string (serializable para IPC)
    photoPath: string;          // Ruta absoluta a la foto capturada
    suggestedPlate: string;     // ANPR OCR suggestion
    ocrStatus: OcrStatus;
    ocrConfidence?: number;
    ocrMessage?: string;
    ocrProcessingTimeMs?: number;
    source: 'ANPR' | 'MANUAL' | 'SIMULATOR' | 'IP_CAMERA_ALPR';
}

/** Evento emitido cuando el ESP32 escanea una tarjeta RFID */
export interface RfidScanEvent {
    rfidCode: string;           // Tag UID (ej. 'A1B2C3D4')
    timestamp: string;          // ISO string
    source: 'ESP32' | 'SIMULATOR';
}

/** Resultado de autorización RFID */
export interface RfidAuthResult {
    authorized: boolean;
    reason: 'PAID' | 'SUBSCRIBER' | 'NOT_FOUND' | 'NOT_PAID' | 'ALREADY_USED' | 'ERROR';
    rfidCode: string;
    plate?: string;
    stayId?: string;
    error?: string;
}

/** Estado del sensor anti-aplastamiento (radar LD2450) */
export type SensorOccupancyState = 'OCCUPIED' | 'CLEAR' | 'UNKNOWN';

/** Resultado de la autorización de salida */
export interface BarrierAuthResult {
    authorized: boolean;
    reason: 'PAID' | 'SUBSCRIBER' | 'NOT_FOUND' | 'NOT_PAID' | 'ALREADY_USED';
    ticketCode: string;
    stayId?: string;
    plate?: string;
    error?: string;
}

// ── Driver Health ────────────────────────────────────────────────────

export interface DriverHealth {
    online: boolean;
    lastHeartbeat: Date | null;
    lastError: string | null;
    reconnectAttempts: number;
    uptimeMs: number;           // ms since last successful connect
}

// ── Base Driver Interface ────────────────────────────────────────────

/** Base contract for all hardware drivers */
export interface IDriver {
    readonly driverType: string;    // 'MOCK' | 'ETHERNET_RELAY' | 'ANPR_WEBHOOK' etc.
    readonly driverName: string;    // Human-readable name
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getHealth(): DriverHealth;
}

// ── Barrier Driver ───────────────────────────────────────────────────

/** Contract for barrier drivers (JOMAF, relay modules, etc.) */
export interface IBarrierDriver extends IDriver {
    openBarrier(type: 'ENTRY' | 'EXIT'): Promise<boolean>;
    closeBarrier(type: 'ENTRY' | 'EXIT'): Promise<boolean>;
    getBarrierState(type: 'ENTRY' | 'EXIT'): 'OPEN' | 'CLOSED' | 'UNKNOWN';

    /** Subscribe to physical button press on the barrier */
    onButtonPress(callback: (type: 'ENTRY' | 'EXIT') => void): void;

    /** Subscribe to vehicle detection (loop detector, sensor, etc.) */
    onVehicleDetected(callback: (type: 'ENTRY' | 'EXIT') => void): void;

    /** Subscribe to RFID tag scanned at exit barrier (bidirectional from ESP32) */
    onRfidScanned(callback: (event: RfidScanEvent) => void): void;

    /** Subscribe to anti-crush sensor state changes (radar LD2450 telemetry) */
    onSensorStateChanged(callback: (state: SensorOccupancyState) => void): void;
}

// ── Camera / ANPR Driver ─────────────────────────────────────────────

/** Contract for ANPR camera drivers */
export interface ICameraDriver extends IDriver {
    /** Subscribe to automatic plate detection events */
    onPlateDetected(callback: (event: HardwareEntryEvent) => void): void;

    /** Manually trigger a capture (returns photo path) */
    triggerCapture(): Promise<string>;

    /** Get path of the last captured photo */
    getLastCapture(): string | null;
}

// ── Scanner Driver ───────────────────────────────────────────────────

/** Contract for barcode/QR scanner drivers */
export interface IScannerDriver extends IDriver {
    /** Subscribe to barcode scan events */
    onBarcodeScanned(callback: (code: string) => void): void;
}

// ── Hardware Status ──────────────────────────────────────────────────

/** Aggregated status emitted to the renderer via IPC */
export interface HardwareStatus {
    entryBarrierOnline: boolean;
    exitBarrierOnline: boolean;
    cameraOnline: boolean;
    scannerOnline: boolean;
    driverType: string;
    lastEventAt: string | null;     // ISO string
    sensorState: SensorOccupancyState;  // Anti-crush radar state
    entryBarrierState: 'OPEN' | 'CLOSED' | 'UNKNOWN';  // Physical barrier arm position
    exitBarrierState: 'OPEN' | 'CLOSED' | 'UNKNOWN';
}

// ── Hardware Configuration ───────────────────────────────────────────

export type BarrierDriverType = 'MOCK' | 'ETHERNET_RELAY';
export type CameraDriverType = 'MOCK' | 'ANPR_WEBHOOK' | 'HIKVISION_ISAPI' | 'IP_CAMERA_ALPR' | 'DISABLED';
export type ScannerDriverType = 'MOCK' | 'USB_HID';

export interface EthernetRelayConfig {
    host: string;
    port: number;
    relayEntryChannel: number;
    relayExitChannel: number;
    pulseDurationMs: number;        // How long to hold relay on (default: 1000)
}

export interface ANPRWebhookConfig {
    listenPort: number;
    authToken?: string;
}

export interface HikvisionISAPIConfig {
    host: string;       // IP or hostname (e.g. '192.168.100.77')
    username: string;   // Default: 'admin'
    password: string;   // Device password
    channel?: number;   // ISAPI channel (default: 101 → channel 1, substream 01)
}

export interface IPCameraALPRConfig {
    snapshotUrl: string;
    username?: string;
    password?: string;
    snapshotTimeoutMs: number;
    alprTimeoutMs: number;
    alprServiceUrl: string;
    minConfidence: number;
    saveCaptures: boolean;
}

export interface ReconnectConfig {
    enabled: boolean;
    intervalMs: number;             // Default: 5000
    maxAttempts: number;            // -1 = infinity
    backoffMultiplier: number;      // Default: 1.5
}

export interface HardwareConfig {
    mockMode: boolean;          // Master switch — when true, overrides barrier/camera/scanner to MOCK
    barrier: {
        driver: BarrierDriverType;
        ethernet?: EthernetRelayConfig;
    };
    camera: {
        driver: CameraDriverType;
        webhook?: ANPRWebhookConfig;
        hikvision?: HikvisionISAPIConfig;
        ipCameraAlpr?: IPCameraALPRConfig;
    };
    scanner: {
        driver: ScannerDriverType;
    };
    reconnect: ReconnectConfig;
}

/** Default config: everything in Mock mode */
export const DEFAULT_HARDWARE_CONFIG: HardwareConfig = {
    mockMode: true,
    barrier: { driver: 'MOCK' },
    camera: { driver: 'MOCK' },
    scanner: { driver: 'MOCK' },
    reconnect: {
        enabled: true,
        intervalMs: 5000,
        maxAttempts: -1,
        backoffMultiplier: 1.5,
    },
};
