/**
 * preload.js — Electron Preload Script
 * 
 * Bridge seguro entre Renderer Process y Main Process.
 * Expone window.electronAPI con canales IPC para impresión silenciosa.
 * 
 * Compatible con contextIsolation: true y false.
 * Cuando contextIsolation es false, contextBridge.exposeInMainWorld
 * simplemente asigna al window global del renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

// --- Zero-Session on Startup: Surgical Sync Cleanup ---
// Ejecutado antes de cargar la SPA de React. Borramos todo rastro anterior en localStorage
// (como viejas sesiones de ag_user o supabase que hayan quedado de versiones previas)
// excepto la configuración física del garaje, vital para la identidad del terminal.
try {
    const keysToPreserve = ['ag_terminal_config', 'selected_printer_name', 'printer_paper_width'];
    // Iterar el localStorage para limpiar
    // Usamos un array de llaves a borrar para evitar problemas mutando la colección mientras iteramos
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !keysToPreserve.includes(key)) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    // Opcional: limpiar también sessionStorage si queremos asegurar inicio fresco
    sessionStorage.clear();
} catch (e) {
    console.warn('⚠️ Error durante la limpieza quirúrgica pre-carga:', e);
}
// --------------------------------------------------------

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Envía HTML al Main Process para impresión silenciosa.
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

    // ── Hardware Integration ──────────────────────────────────

    /** Listener: evento de entrada detectado por hardware/simulador */
    onHardwareEntry: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on('hw:entry-detected', handler);
        return () => ipcRenderer.removeListener('hw:entry-detected', handler);
    },

    /** Listener: resultado de autorización de barrera de salida */
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

    /** Obtener y guardar configuración de hardware */
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

    /** DEV / Simulación */
    simulateEntry: () => ipcRenderer.invoke('hw:simulate-entry'),
    simulateBarcodeScan: (code) => ipcRenderer.invoke('hw:simulate-barcode', code),
});
