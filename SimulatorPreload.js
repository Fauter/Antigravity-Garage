/**
 * SimulatorPreload.js — Preload para la ventana del Simulador de Hardware
 * 
 * Expone canales IPC específicos para el simulador.
 * Separado del preload principal para aislamiento de seguridad.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('simulatorAPI', {
    // Simular ingreso de vehículo (botón físico + cámara ANPR)
    simulateEntry: () => ipcRenderer.invoke('hw:simulate-entry'),

    // Simular escaneo de barcode en barrera de salida
    simulateBarcodeScan: (ticketCode) => ipcRenderer.invoke('hw:simulate-barcode', ticketCode),

    // Obtener estado del hardware
    getHardwareStatus: () => ipcRenderer.invoke('hw:get-status'),

    // Listeners para resultados
    onEntryResult: (callback) => {
        ipcRenderer.on('sim:entry-result', (_event, data) => callback(data));
    },
    onExitResult: (callback) => {
        ipcRenderer.on('sim:exit-result', (_event, data) => callback(data));
    }
});
