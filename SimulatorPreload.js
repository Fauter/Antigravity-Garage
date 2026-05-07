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

    // ── RFID: Simulate tag scan at exit barrier ──
    simulateRfid: (rfidCode) => ipcRenderer.invoke('hw:simulate-rfid', rfidCode),

    // ── Sensor: Simulate anti-crush radar state ──
    simulateSensor: (state) => ipcRenderer.invoke('hw:simulate-sensor', state),

    // Obtener estado del hardware
    getHardwareStatus: () => ipcRenderer.invoke('hw:get-status'),

    // 🔀 Mock Mode Control 🔀
    setMockMode: (enabled) => ipcRenderer.invoke('hw:set-mock-mode', enabled),
    getMockMode: () => ipcRenderer.invoke('hw:get-mock-mode'),
    getHardwareConfig: () => ipcRenderer.invoke('hw:get-config'),

    // 📡 Listeners 📡
    onEntryResult: (callback) => {
        ipcRenderer.on('sim:entry-result', (_event, data) => callback(data));
    },
    onExitResult: (callback) => {
        ipcRenderer.on('sim:exit-result', (_event, data) => callback(data));
    },
    onRfidResult: (callback) => {
        ipcRenderer.on('sim:rfid-result', (_event, data) => callback(data));
    },
    onSensorState: (callback) => {
        ipcRenderer.on('sim:sensor-state', (_event, data) => callback(data));
    },
    onMockModeChanged: (callback) => {
        ipcRenderer.on('hw:mock-mode-changed', (_event, data) => callback(data));
    },
    // 📡 Hardware Status (barrier states, sensor, etc.) ──
    onHardwareStatus: (callback) => {
        ipcRenderer.on('hw:status-changed', (_event, data) => callback(data));
    },
});
