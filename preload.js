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
    const keysToPreserve = ['ag_terminal_config'];
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
    // Opcional: limpiar también sessionStorage si queremos asegurar inicio fresco (generalmente ya viene vacío en un inicio limpio del BrowserWindow)
    sessionStorage.clear();
} catch (e) {
    console.warn('⚠️ Error durante la limpieza quirúrgica pre-carga:', e);
}
// --------------------------------------------------------

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Envía HTML al Main Process para impresión silenciosa.
     * @param {string} html - HTML completo del ticket
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    silentPrint: (html) => ipcRenderer.invoke('print:silent', html),

    /**
     * Obtiene la lista de impresoras del sistema.
     * @returns {Promise<Array<{name: string, isDefault: boolean, status: number}>>}
     */
    getPrinters: () => ipcRenderer.invoke('print:get-printers'),
});
