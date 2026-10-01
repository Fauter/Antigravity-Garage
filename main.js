const { app, BrowserWindow, Menu, ipcMain, protocol, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { initPrintManager } = require('./PrintManager');
const { initHardwareService } = require('./HardwareService');

// Blindaje Total de DPI (Nivel Engine)
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// --- Setup Logging ---
const userDataPath = app.getPath('userData');
const logsDir = path.join(userDataPath, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
const startupLogPath = path.join(logsDir, 'startup.log');
const backendLogPath = path.join(logsDir, 'backend.log');

if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] userData resolved:', userDataPath);

function safeSerialize(arg) {
    try {
        if (arg === null) return "null";
        if (arg === undefined) return "undefined";
        if (arg instanceof Error) return arg.stack || arg.message;
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return "[Unserializable Object]";
            }
        }
        return String(arg);
    } catch (err) {
        return "[Serialization Error]";
    }
}

function appendLog(file, prefix, ...args) {
    try {
        const msg = args.map(safeSerialize).join(' ');
        const line = `[${new Date().toISOString()}] ${prefix} ${msg}\n`;
        fs.appendFileSync(file, line);
    } catch (globalErr) {
        try {
            fs.appendFileSync(file, `[${new Date().toISOString()}] [LOGGER_ERROR] Fallback log\n`);
        } catch (e) {}
    }
}

const origLog = console.log;
const origError = console.error;
console.log = (...args) => {
    origLog(...args);
    appendLog(startupLogPath, '[INFO]', ...args);
};
console.error = (...args) => {
    origError(...args);
    appendLog(startupLogPath, '[ERROR]', ...args);
};



if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') {
    console.log('[ELECTRON:TRACE] process started');
}

process.on('uncaughtException', (err) => {
    console.error('[STARTUP:FATAL] Uncaught Exception:', err);
    if (!isDev) {
        dialog.showMessageBoxSync({
            type: 'error',
            title: 'GarageIA Error Fatal',
            message: 'GarageIA no pudo iniciar.\nSe generó un diagnóstico en:\n' + logsDir,
            buttons: ['Abrir carpeta de logs', 'Cerrar']
        }) === 0 && shell.openPath(logsDir);
        app.exit(1);
    }
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[STARTUP:FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.on('render-process-gone', (event, webContents, details) => {
    console.error('[STARTUP:FATAL] render-process-gone', details);
});
app.on('child-process-gone', (event, details) => {
    console.error('[STARTUP:FATAL] child-process-gone', details);
});

// ── TSX Register: MUST be loaded before any .ts require ──────────────
if (isDev) {
    try {
        require('tsx');
        console.log('🛠️ [DEV] tsx loaded — TypeScript imports enabled');
    } catch (e) {
        console.error('❌ Error: El paquete "tsx" es necesario en desarrollo.', e.message);
    }
}

const startServer = () => {
    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] backend start requested');
    let serverPath;
    if (isDev) {
        serverPath = path.join(__dirname, 'src/infrastructure/http/server.ts');
    } else {
        if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] PROD Cargando servidor pre-compilado (CommonJS)...');
        serverPath = path.join(__dirname, 'dist_main/infrastructure/http/server.js');
    }

    if (fs.existsSync(serverPath)) {
        try {
            if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] storage preflight');
            require(serverPath);
            
        } catch (err) {
            console.error(`[STARTUP:FATAL] Error crítico al ejecutar el servidor:`, err);
            if (!isDev) {
                dialog.showMessageBoxSync({
                    type: 'error',
                    title: 'GarageIA no pudo iniciar',
                    message: 'GarageIA no pudo iniciar el backend.\nSe generó un diagnóstico en:\n' + logsDir,
                    buttons: ['Abrir carpeta de logs', 'Cerrar']
                }) === 0 && shell.openPath(logsDir);
                app.exit(1);
            }
        }
    } else {
        console.error(`[STARTUP:FATAL] No se encontró el servidor en: ${serverPath}`);
        if (!isDev) {
            dialog.showMessageBoxSync({
                type: 'error',
                title: 'GarageIA no pudo iniciar',
                message: 'Falta el archivo principal del backend.\nDiagnóstico en:\n' + logsDir,
                buttons: ['Abrir carpeta de logs', 'Cerrar']
            }) === 0 && shell.openPath(logsDir);
            app.exit(1);
        }
    }
};

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('[STARTUP:FATAL] Otra instancia ya está ejecutándose. Saliendo...');
    app.quit();
    return; // Stop execution
}

// Log APP_START only if we actually got the lock
try {
    const opsLogPath = path.join(logsDir, 'ops.log');
    const appStartEvent = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        operation: 'APP_START',
        status: 'SUCCESS',
        appVersion: app.getVersion()
    };
    fs.appendFileSync(opsLogPath, JSON.stringify(appStartEvent) + '\n', 'utf8');
} catch (e) {
    console.error('[ELECTRON:TRACE] Error writing APP_START to ops.log:', e);
}

let mainWindow = null;

app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Alguien intentó abrir una segunda instancia, enfocar nuestra ventana
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

if (isDev) {
    console.log('🛠️ [DEV] Saltando orquestación interna del Backend (ya manejada por concurrently)');
} else {
    startServer();
}

function attachRendererDiagnostics(win) {

    if (!isDev) return;

    // 1. Console Forwarding
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
        const levelStr = levels[level] || 'LOG';
        const src = sourceId ? `${path.basename(sourceId)}:${line}` : 'unknown';
        if (level >= 2) {
            console.error(`[RENDERER:${levelStr}] ${message}\n  source: ${src}`);
        } else {
            console.log(`[RENDERER:${levelStr}] ${message}\n  source: ${src}`);
        }
    });

    // 2. Lifecycle & Errors
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (errorCode !== -3) { // ERR_ABORTED is typically benign
            console.error(`[RENDERER:FAILED-LOAD] ${errorDescription} (${errorCode}) at ${validatedURL}`);
            // Retry navigation once if connection was refused and it was trying to reach our server
            if (errorCode === -102 && validatedURL.includes('localhost:3000') && !win.hasRetriedLoad) {
                console.log(`[RENDERER:RETRY] Retrying loadURL for ${validatedURL} in 2000ms...`);
                win.hasRetriedLoad = true;
                setTimeout(() => {
                    win.loadURL(validatedURL);
                }, 2000);
            }
        }
    });

    win.webContents.on('render-process-gone', (event, details) => {
        console.error(`[RENDERER:CRASH] Render process gone! Reason: ${details.reason}, ExitCode: ${details.exitCode}`);
    });

    win.webContents.on('preload-error', (event, preloadPath, error) => {
        console.error(`[RENDERER:PRELOAD-ERROR] Error in preload: ${preloadPath}`, error);
    });

    win.webContents.on('unresponsive', () => {
        console.error(`[RENDERER:UNRESPONSIVE] Window became unresponsive`);
    });

    win.webContents.on('responsive', () => {
        console.log(`[RENDERER:RESPONSIVE] Window became responsive again`);
    });

    // 3. Auto-open DevTools
    win.webContents.once('did-finish-load', () => {
        if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] renderer ready');
        win.webContents.openDevTools({ mode: 'detach', activate: true });
    });
}

function waitForBackendReady(port, timeoutMs = 90000, retryMs = 500) {
    const http = require('http');
    const startTime = Date.now();
    let attempt = 0;
    
    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] waiting for backend readiness...');

    return new Promise((resolve, reject) => {
        const check = () => {
            attempt++;
            if (Date.now() - startTime > timeoutMs) {
                return reject(new Error('Timeout waiting for backend'));
            }
            
            const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
                if (res.statusCode === 200) {
                    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log(`[ELECTRON:TRACE] READY after ${Date.now() - startTime}ms (attempt ${attempt})`);
                    resolve();
                } else {
                    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log(`[ELECTRON:TRACE] health attempt ${attempt} returned status ${res.statusCode}`);
                    setTimeout(check, retryMs);
                }
            });

            req.on('error', (err) => {
                // connection refused typically
                setTimeout(check, retryMs);
            });
            
            req.setTimeout(retryMs, () => {
                req.destroy();
            });
        };
        
        check();
    });
}

function createWindow() {
    // Helper IPC para leer imágenes locales y enviarlas como Base64 al Renderer
    ipcMain.handle('fs:readFileBase64', async (event, filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                const ext = path.extname(filePath).toLowerCase();
                let mimeType = 'image/jpeg';
                if (ext === '.png') mimeType = 'image/png';
                else if (ext === '.webp') mimeType = 'image/webp';
                const buffer = fs.readFileSync(filePath);
                return `data:${mimeType};base64,${buffer.toString('base64')}`;
            }
        } catch (e) {
            console.error('Error reading local file to base64:', e);
        }
        return filePath;
    });

    // Ícono: build/icon.png es la misma fuente que usa electron-builder → siempre presente.
    const iconPath = path.join(__dirname, 'build', 'icon.png');

    const isWindows = process.platform === 'win32';

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false, // Initially hidden while backend boots
        title: 'GarageIA - Control de Estacionamiento',
        icon: iconPath,
        ...(isWindows ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: {
                color: '#030712', // Dark blue background (Tailwind bg-gray-950)
                symbolColor: '#E6EDF7' // Light text color
            }
        } : {}),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            enableRemoteModule: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] BrowserWindow created');

    // Interfaz limpia tipo Kiosko: eliminar barra de menú (File, Edit, View…)
    Menu.setApplicationMenu(null);
    
    attachRendererDiagnostics(mainWindow);
    
    mainWindow.webContents.once('did-finish-load', () => {
        if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] renderer ready, showing window');
        mainWindow.show();
    });

    // In development, load the Vite dev server
    // In production, load the Express server (which serves the static SPA)
    const targetUrl = isDev ? 'http://localhost:5173' : 'http://localhost:3000';
    
    const loadApp = () => {
        if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log(`[ELECTRON:TRACE] renderer load started for ${targetUrl}`);
        mainWindow.loadURL(targetUrl);
    };

    if (isDev) {
        loadApp();
    } else {
        waitForBackendReady(3000, 90000, 500)
            .then(() => {
                loadApp();
            })
            .catch((err) => {
                console.error('[ELECTRON:FATAL] Backend readiness timeout:', err);
                dialog.showMessageBoxSync({
                    type: 'error',
                    title: 'Error de Inicio',
                    message: 'GarageIA no pudo iniciar el servicio local a tiempo.\nPor favor, revise los logs.\n' + logsDir,
                    buttons: ['Abrir Logs', 'Cerrar']
                }) === 0 && shell.openPath(logsDir);
                app.exit(1);
            });
    }

    // Force Logout Quirúrgico: Ahora manejado sincrónicamente en preload.js
    // para evitar race conditions con React y Supabase.

    // Atajos de teclado globales (F11 = fullscreen, Esc = salir de fullscreen)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        if (input.key === 'F11') {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
            event.preventDefault();
        } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
            mainWindow.setFullScreen(false);
            event.preventDefault();
        } else if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
            event.preventDefault();
            if (mainWindow.webContents.isDevToolsOpened()) {
                console.log('[DEVTOOLS] Closing renderer DevTools');
                mainWindow.webContents.closeDevTools();
            } else {
                console.log('[DEVTOOLS] Opening renderer DevTools');
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        } else if (isDev && input.key === 'F12') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            require('electron').shell.openExternal(url);
        }
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] app ready');
    protocol.registerFileProtocol('garagemedia', (request, callback) => {
        const url = request.url.replace('garagemedia://', '');
        try {
            const decodedUrl = decodeURI(url);
            const absolutePath = path.join(process.cwd(), '.data', decodedUrl);
            callback({ path: absolutePath });
        } catch (error) {
            console.error('❌ [Protocol] Error parsing garagemedia URL:', error);
        }
    });

    createWindow();
    initPrintManager();
    initHardwareService(mainWindow, isDev);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
