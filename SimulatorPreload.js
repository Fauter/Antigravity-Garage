/**
 * SimulatorPreload.js — Preload para la ventana del Simulador de Hardware
 * 
 * Expone canales IPC específicos para el simulador.
 * Separado del preload principal para aislamiento de seguridad.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('simulatorAPI', {
    // Simular ingreso de vehículo (botón físico + cámara)
    simulateEntry: () => ipcRenderer.invoke('hw:simulate-entry'),

    // Simular escaneo de barcode en barrera de salida
    simulateBarcodeScan: (ticketCode) => ipcRenderer.invoke('hw:simulate-barcode', ticketCode),

    // Obtener estado del hardware
    getHardwareStatus: () => ipcRenderer.invoke('hw:get-status'),

    // ── Mock Mode Control ──
    setMockMode: (enabled) => ipcRenderer.invoke('hw:set-mock-mode', enabled),
    getMockMode: () => ipcRenderer.invoke('hw:get-mock-mode'),
    getHardwareConfig: () => ipcRenderer.invoke('hw:get-config'),

    // ── Listeners ──
    onEntryResult: (callback) => {
        ipcRenderer.on('sim:entry-result', (_event, data) => callback(data));
    },
    onExitResult: (callback) => {
        ipcRenderer.on('sim:exit-result', (_event, data) => callback(data));
    },
    onMockModeChanged: (callback) => {
        ipcRenderer.on('hw:mock-mode-changed', (_event, data) => callback(data));
    },
});
