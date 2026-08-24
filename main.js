const { app, BrowserWindow, Menu, ipcMain, protocol } = require('electron');
const path = require('path');
const { initPrintManager } = require('./PrintManager');
const { initHardwareService } = require('./HardwareService');

// Blindaje Total de DPI (Nivel Engine)
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ── TSX Register: MUST be loaded before any .ts require ──────────────
// Previously this was inside startServer() which only ran in production.
// HardwareService.js needs it to require HardwareOrchestrator.ts.
if (isDev) {
    try {
        require('tsx');
        console.log('🛠️ [DEV] tsx loaded — TypeScript imports enabled');
    } catch (e) {
        console.error('❌ Error: El paquete "tsx" es necesario en desarrollo.', e.message);
    }
}

// Start the backend server
const fs = require('fs');

const startServer = () => {
    console.log('🚀 [ELECTRON] Iniciando proceso de orquestación del Backend...');

    let serverPath;
    if (isDev) {
        serverPath = path.join(__dirname, 'src/infrastructure/http/server.ts');
    } else {
        console.log('📦 [PROD] Cargando servidor pre-compilado (CommonJS)...');
        // In production, we point to the compiled .js file inside the asar or resources
        serverPath = path.join(__dirname, 'dist_main/infrastructure/http/server.js');
    }

    if (fs.existsSync(serverPath)) {
        try {
            require(serverPath);
            console.log('✅ Servidor cargado exitosamente.');
        } catch (err) {
            console.error(`❌ Error crítico al ejecutar el servidor:`, err);
        }
    } else {
        console.error(`❌ ERROR CRÍTICO: No se encontró el servidor en: ${serverPath}`);
        if (!isDev) {
            console.error('Verifica que dist_main haya sido incluido en el empaquetado.');
        }
    }
};

if (isDev) {
    console.log('🛠️ [DEV] Saltando orquestación interna del Backend (ya manejada por concurrently)');
} else {
    startServer(); // Solo arranca el servidor interno si NO estamos en desarrollo
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
        win.webContents.openDevTools({ mode: 'detach', activate: true });
    });
}

let mainWindow;

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

    // Interfaz limpia tipo Kiosko: eliminar barra de menú (File, Edit, View…)
    Menu.setApplicationMenu(null);

    // In development, load the Vite dev server
    // In production, load the Express server (which serves the static SPA)
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadURL('http://localhost:3000');
    }

    attachRendererDiagnostics(mainWindow);

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
        } else if (isDev && (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'))) {
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
