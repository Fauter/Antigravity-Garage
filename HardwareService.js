/**
 * HardwareService.js — Orquestador de Hardware (Electron Main Process)
 *
 * Similar a PrintManager.js: módulo CommonJS que vive en el Main Process.
 * Gestiona el MockDriver, IPC con el renderer, y la ventana del simulador.
 *
 * Responsabilidades:
 *  1. Registrar handlers IPC para eventos de hardware
 *  2. Gestionar la ventana del Simulador de Hardware (Ctrl+Shift+D)
 *  3. MockDriver: generar eventos de entrada simulados
 *  4. Consultar NeDB local para validación de salida (exit_authorized)
 *  5. Emitir eventos al renderer para el sistema de pestañas
 */

const { BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── NeDB Direct Access (for exit authorization queries) ────────────
// CRITICAL: Must resolve DATA_DIR the same way as datastore.ts to avoid
// reading a different database file. In dev mode, the backend (tsx process)
// writes to .data/ because it can't access Electron. The HardwareService
// runs inside Electron but must read from the SAME path.
const Datastore = require('nedb-promises');

let DATA_DIR;
let staysDb = null;
let hardwareEventsDb = null;

function resolveDataDir(isDev) {
    try {
        const { app } = require('electron');
        if (app && app.isPackaged) {
            DATA_DIR = path.join(app.getPath('userData'), 'database');
        } else {
            DATA_DIR = path.resolve(process.cwd(), '.data');
        }
    } catch (e) {
        DATA_DIR = path.resolve(process.cwd(), '.data');
    }

    console.log(`\n======================================================`);
    console.log(`📂 [HardwareService] LEYENDO BD EN RUTA:`);
    console.log(`📂 ${DATA_DIR}`);
    console.log(`======================================================\n`);

    staysDb = Datastore.create({
        filename: path.join(DATA_DIR, 'stays.db'),
        autoload: true
    });

    hardwareEventsDb = Datastore.create({
        filename: path.join(DATA_DIR, 'hardware_events.db'),
        autoload: true
    });
}

// ── State ──────────────────────────────────────────────────────────
let mainWindowRef = null;
let simulatorWindow = null;
let isDevMode = false;

// Random plate generator (Argentine format)
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
function randomPlate() {
    // New format: AA 000 AA
    const l = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const d = () => DIGITS[Math.floor(Math.random() * DIGITS.length)];
    return `${l()}${l()}${d()}${d()}${d()}${l()}${l()}`;
}

// ── Captures Directory ─────────────────────────────────────────────
function getCapturesDir() {
    const dir = path.join(DATA_DIR, '..', 'captures');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

// Generate a placeholder photo (simple 1x1 pixel PNG for now)
function generatePlaceholderPhoto() {
    const capturesDir = getCapturesDir();
    const filename = `mock_${Date.now()}_${uuidv4().slice(0, 8)}.txt`;
    const filepath = path.join(capturesDir, filename);
    // Write a simple placeholder marker (real ANPR would save a JPEG)
    fs.writeFileSync(filepath, `MOCK_CAPTURE_${new Date().toISOString()}`);
    return filepath;
}

// ── Mock Entry Event ───────────────────────────────────────────────
async function simulateEntryEvent() {
    const plate = randomPlate();
    const photoPath = generatePlaceholderPhoto();

    const event = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        photoPath: photoPath,
        suggestedPlate: plate,
        source: 'SIMULATOR'
    };

    // Log to hardware events DB
    await hardwareEventsDb.insert({
        ...event,
        type: 'ENTRY_DETECTED',
        createdAt: new Date()
    });

    console.log(`🎮 [HardwareSimulator] Entry event: ${plate}`);

    // Emit to main renderer window (EntryPanel tabs)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('hw:entry-detected', event);
    }

    // Emit result back to simulator window
    if (simulatorWindow && !simulatorWindow.isDestroyed()) {
        simulatorWindow.webContents.send('sim:entry-result', {
            success: true,
            plate: plate,
            eventId: event.id
        });
    }

    return event;
}

// ── Exit Authorization Check ───────────────────────────────────────
async function checkExitAuthorization(ticketCode) {
    console.log(`🎮 [HardwareSimulator] Checking exit auth for: ${ticketCode}`);

    try {
        const normalizedCode = ticketCode.trim().toUpperCase();

        // Query ALL stays with this ticket_code (regardless of active status)
        // After payment: active=false, exit_authorized=true — we MUST find these
        const candidates = await staysDb.find({ ticket_code: normalizedCode });

        // Fallback: case-insensitive search if exact match fails
        let matches = candidates;
        if (matches.length === 0) {
            const allStays = await staysDb.find({});
            matches = allStays.filter(s =>
                s.ticket_code && s.ticket_code.toUpperCase() === normalizedCode
            );
        }

        if (matches.length === 0) {
            console.log(`❌ [HardwareService] Ticket ${normalizedCode} not found in DB`);
            return { authorized: false, reason: 'NOT_FOUND', ticketCode: normalizedCode };
        }

        // Get the most recent stay (by entryTime) to avoid old ticket collisions
        const stay = matches.sort((a, b) =>
            new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
        )[0];

        console.log(`🔍 [HardwareService] Found stay: id=${stay.id}, plate=${stay.plate}, active=${stay.active}, exit_authorized=${stay.exit_authorized}`);

        return checkStayAuth(stay, normalizedCode);
    } catch (err) {
        console.error('❌ [HardwareService] Exit auth query error:', err);
        return { authorized: false, reason: 'NOT_FOUND', ticketCode, error: err.message };
    }
}

function checkStayAuth(stay, ticketCode) {
    // Anti-passback: already used
    if (stay.barrier_exit_used === true) {
        return {
            authorized: false,
            reason: 'ALREADY_USED',
            ticketCode,
            stayId: stay.id,
            plate: stay.plate
        };
    }

    // Check authorization
    if (stay.exit_authorized === true) {
        // Mark as used (async, non-blocking)
        staysDb.update(
            { id: stay.id },
            { $set: { barrier_exit_used: true, barrier_exit_at: new Date() } },
            {}
        ).catch(err => console.error('⚠️ Failed to mark barrier_exit_used:', err));

        return {
            authorized: true,
            reason: 'PAID',
            ticketCode,
            stayId: stay.id,
            plate: stay.plate
        };
    }

    // Check subscriber (subscribers always authorized)
    if (stay.isSubscriber || stay.is_subscriber) {
        staysDb.update(
            { id: stay.id },
            { $set: { barrier_exit_used: true, barrier_exit_at: new Date() } },
            {}
        ).catch(err => console.error('⚠️ Failed to mark barrier_exit_used:', err));

        return {
            authorized: true,
            reason: 'SUBSCRIBER',
            ticketCode,
            stayId: stay.id,
            plate: stay.plate
        };
    }

    // Not authorized (not paid)
    return {
        authorized: false,
        reason: 'NOT_PAID',
        ticketCode,
        stayId: stay.id,
        plate: stay.plate
    };
}

// ── Simulator Window ───────────────────────────────────────────────
function openSimulatorWindow() {
    if (simulatorWindow && !simulatorWindow.isDestroyed()) {
        simulatorWindow.focus();
        return;
    }

    simulatorWindow = new BrowserWindow({
        width: 520,
        height: 640,
        title: 'GarageIA — Hardware Simulator',
        alwaysOnTop: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'SimulatorPreload.js')
        }
    });

    simulatorWindow.setMenuBarVisibility(false);

    const simulatorPath = path.join(__dirname, 'simulator.html');
    if (fs.existsSync(simulatorPath)) {
        simulatorWindow.loadFile(simulatorPath);
    } else {
        console.error('❌ [HardwareService] simulator.html not found at:', simulatorPath);
        simulatorWindow.destroy();
        return;
    }

    simulatorWindow.on('closed', () => {
        simulatorWindow = null;
    });

    console.log('🎮 [HardwareService] Simulator window opened');
}

// ── Init ───────────────────────────────────────────────────────────
function initHardwareService(mainWindow, isDev) {
    mainWindowRef = mainWindow;
    isDevMode = isDev;

    // CRITICAL: Must resolve DATA_DIR before any DB access
    resolveDataDir(isDev);

    console.log('🔌 [HardwareService] Initializing hardware layer (Mock Driver)...');

    // ── IPC Handlers ──
    ipcMain.handle('hw:simulate-entry', async () => {
        return await simulateEntryEvent();
    });

    ipcMain.handle('hw:simulate-barcode', async (_event, ticketCode) => {
        const result = await checkExitAuthorization(ticketCode);

        // Emit to simulator window
        if (simulatorWindow && !simulatorWindow.isDestroyed()) {
            simulatorWindow.webContents.send('sim:exit-result', result);
        }

        // Also emit to main window for potential UI updates
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            mainWindowRef.webContents.send('hw:barrier-auth-result', result);
        }

        return result;
    });

    ipcMain.handle('hw:get-status', () => {
        return {
            entryBarrierOnline: true,  // Mock always online
            exitBarrierOnline: true,
            cameraOnline: true,
            driverType: 'MOCK',
            lastEventAt: null
        };
    });

    ipcMain.handle('hw:open-simulator', () => {
        openSimulatorWindow();
        return { opened: true };
    });

    // ── Global Shortcut: Ctrl+Shift+D → Open Simulator ──
    // Register after app is ready (called from main.js after app.whenReady)
    try {
        const { app } = require('electron');
        // We register the shortcut on the mainWindow's webContents instead
        // to avoid conflicts with system shortcuts
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.on('before-input-event', (event, input) => {
                if (input.type === 'keyDown' &&
                    input.shift && input.control &&
                    input.key.toUpperCase() === 'D') {
                    openSimulatorWindow();
                    event.preventDefault();
                }
            });
        }
    } catch (err) {
        console.warn('⚠️ [HardwareService] Could not register shortcut:', err.message);
    }

    console.log('✅ [HardwareService] Mock Driver initialized. Press Ctrl+Shift+D to open simulator.');
}

module.exports = { initHardwareService };
