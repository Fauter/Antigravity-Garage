/**
 * preload.js â€” Electron Preload Script
 * 
 * Bridge seguro entre Renderer Process y Main Process.
 * Expone window.electronAPI con canales IPC para impresiÃ³n silenciosa.
 * 
 * Compatible con contextIsolation: true y false.
 * Cuando contextIsolation es false, contextBridge.exposeInMainWorld
 * simplemente asigna al window global del renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

// --- Zero-Session on Startup: Surgical Sync Cleanup ---
// Ejecutado antes de cargar la SPA de React. Borramos todo rastro anterior en localStorage
// (como viejas sesiones de ag_user o supabase que hayan quedado de versiones previas)
// excepto la configuraciÃ³n fÃ­sica del garaje, vital para la identidad del terminal.
try {
    // PROTECCIÃ“N DE SEGURIDAD: Solo limpiar si el documento cargÃ³ en el origin correcto
    if (window.location.origin.includes('localhost')) {
        const keysToPreserve = ['ag_terminal_config', 'selected_printer_name', 'printer_paper_width'];
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && !keysToPreserve.includes(key)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        if (!sessionStorage.getItem('ag_window_bootstrapped')) {
            sessionStorage.clear();
            sessionStorage.setItem('ag_window_bootstrapped', '1');
        }
    }
} catch (e) {
    console.warn('âš ï¸ Error durante la limpieza quirÃºrgica pre-carga:', e);
}
// --------------------------------------------------------

try {
    contextBridge.exposeInMainWorld('electronAPI', {
        /**
         * EnvÃ­a HTML al Main Process para impresiÃ³n silenciosa.
         * @param {string} html - HTML completo del ticket
         * @param {object} [printerConfig] - { deviceName?: string, pageWidth?: number (micrones) }
         * @returns {Promise<{success: boolean, error?: string}>}
         */
        silentPrint: (html, printerConfig) => ipcRenderer.invoke('print:silent', html, printerConfig || {}),

        /**
         * Obtiene la lista de impresoras del sistema.
         * @returns {Promise<Array<{name: string, isDefault: boolean, status: number}>>}
         */
        getPrinters: () => ipcRenderer.invoke('print:get-printers'),

        /**
         * Lee un archivo local y lo devuelve en Base64.
         */
        readFileBase64: (filePath) => ipcRenderer.invoke('fs:readFileBase64', filePath),
        recoverBackend: () => ipcRenderer.invoke('backend:recover'),

        // â”€â”€ Hardware Integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        /** Listener: evento de entrada detectado por hardware/simulador */
        onHardwareEntry: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('hw:entry-detected', handler);
            return () => ipcRenderer.removeListener('hw:entry-detected', handler);
        },

        /** Listener: resultado de autorizaciÃ³n de barrera de salida */
        onBarrierAuthResult: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('hw:barrier-auth-result', handler);
            return () => ipcRenderer.removeListener('hw:barrier-auth-result', handler);
        },

        /** Listener: cambios generales de estado online/offline del HW */
        onHardwareStatusChanged: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('hw:status-changed', handler);
            return () => ipcRenderer.removeListener('hw:status-changed', handler);
        },

        /** Obtener estado actual del hardware */
        getHardwareStatus: () => ipcRenderer.invoke('hw:get-status'),

        /** Obtener y guardar configuraciÃ³n de hardware */
        getHardwareConfig: () => ipcRenderer.invoke('hw:get-config'),
        setHardwareConfig: (config) => ipcRenderer.invoke('hw:set-config', config),

        /** Mock Mode control */
        getMockMode: () => ipcRenderer.invoke('hw:get-mock-mode'),
        setMockMode: (enabled) => ipcRenderer.invoke('hw:set-mock-mode', enabled),

        /** Listener: mock mode changed (from Simulator toggle) */
        onMockModeChanged: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('hw:mock-mode-changed', handler);
            return () => ipcRenderer.removeListener('hw:mock-mode-changed', handler);
        },

        /** Listener: driver connection status toast (online/offline notifications) */
        onDriverStatusToast: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('hw:driver-status-toast', handler);
            return () => ipcRenderer.removeListener('hw:driver-status-toast', handler);
        },

        /** Control manual */
        openBarrier: (type) => ipcRenderer.invoke('hw:open-barrier', type),
        openHardwareSimulator: () => ipcRenderer.invoke('hw:open-simulator'),

        /** DEV / SimulaciÃ³n */
        simulateEntry: () => ipcRenderer.invoke('hw:simulate-entry'),
        simulateBarcodeScan: (code) => ipcRenderer.invoke('hw:simulate-barcode', code),

        // â”€â”€ Bidirectional ESP32 Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        /** Listener: RFID authorization result (auto-exit flow) */
        onRfidAuthResult: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('hw:rfid-auth-result', handler);
            return () => ipcRenderer.removeListener('hw:rfid-auth-result', handler);
        },

        /** Listener: anti-crush sensor state changes (OCCUPIED/CLEAR) */
        onSensorStateChanged: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('hw:sensor-state-changed', handler);
            return () => ipcRenderer.removeListener('hw:sensor-state-changed', handler);
        },
    });
} catch (error) {
    console.error('[PRELOAD:ERROR] Error exposing electronAPI to MainWorld:', error);
    throw error;
}

