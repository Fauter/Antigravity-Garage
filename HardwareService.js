/**
 * HardwareService.js — Shim de compatibilidad (Electron Main Process)
 *
 * Este archivo mantiene la misma interfaz que main.js espera:
 *   const { initHardwareService } = require('./HardwareService');
 *   initHardwareService(mainWindow, isDev);
 *
 * Internamente, delega TODA la lógica al HardwareOrchestrator.ts
 * que implementa el Strategy Pattern con drivers intercambiables.
 *
 * IMPORTANT: tsx/register MUST be loaded by main.js before this module
 * attempts to require .ts files. In dev mode, main.js loads it at startup.
 * In production, the compiled .js from dist_main/ is used instead.
 */

const path = require('path');

let orchestrator = null;

async function initHardwareService(mainWindow, isDev) {
    console.log('[HW-DEBUG] HardwareService.js shim called');

    try {
        let OrchestratorModule;

        if (isDev) {
            // Dev mode: tsx/register is already loaded by main.js
            // Use path.join for Windows path compatibility
            const tsPath = path.join(__dirname, 'src', 'hardware', 'HardwareOrchestrator');
            console.log('[HW-DEBUG] Loading Orchestrator from TS:', tsPath);
            OrchestratorModule = require(tsPath);
        } else {
            // Production: use pre-compiled JS from dist_main/
            const jsPath = path.join(__dirname, 'dist_main', 'hardware', 'HardwareOrchestrator');
            console.log('[HW-DEBUG] Loading Orchestrator from compiled JS:', jsPath);
            OrchestratorModule = require(jsPath);
        }

        console.log('[HW-DEBUG] >>> EL ORQUESTADOR CARGÓ CORRECTAMENTE');

        const { HardwareOrchestrator } = OrchestratorModule;
        orchestrator = new HardwareOrchestrator();
        await orchestrator.initialize(mainWindow, isDev);
        console.log('[HW-DEBUG] HardwareService.js shim: Orchestrator initialized successfully');
    } catch (err) {
        console.error('[HW-DEBUG] ❌ HardwareService.js shim: Orchestrator initialization FAILED:', err);
    }
}

module.exports = { initHardwareService };
