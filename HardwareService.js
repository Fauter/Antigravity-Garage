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
    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') {
        console.log('[HW:TRACE] HardwareService.js shim called');
    }

    try {
        let OrchestratorModule;

        if (isDev) {
            const tsPath = path.join(__dirname, 'src', 'hardware', 'HardwareOrchestrator');
            OrchestratorModule = require(tsPath);
        } else {
            const jsPath = path.join(__dirname, 'dist_main', 'hardware', 'HardwareOrchestrator');
            OrchestratorModule = require(jsPath);
        }

        const { HardwareOrchestrator } = OrchestratorModule;
        orchestrator = new HardwareOrchestrator();
        await orchestrator.initialize(mainWindow, isDev);
    } catch (err) {
        console.error('[HW-DEBUG] ❌ HardwareService.js shim: Orchestrator initialization FAILED:', err);
    }
}

module.exports = { initHardwareService };
