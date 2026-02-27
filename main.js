const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Start the backend server
const fs = require('fs');

const startServer = () => {
    console.log('🚀 [ELECTRON] Iniciando proceso de orquestación del Backend...');

    let serverPath;
    if (isDev) {
        console.log('🛠️ [DEV] Registrando transpiler tsx para ejecución directa...');
        try {
            require('tsx/register');
            serverPath = path.join(__dirname, 'src/infrastructure/http/server.ts');
        } catch (e) {
            console.error('❌ Error: El paquete "tsx" es necesario en desarrollo.');
            process.exit(1);
        }
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

startServer();

let mainWindow;

function createWindow() {
    // Ícono: build/icon.png es la misma fuente que usa electron-builder → siempre presente.
    const iconPath = path.join(__dirname, 'build', 'icon.png');

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'GarageIA - Control de Estacionamiento',
        icon: iconPath,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    // Interfaz limpia tipo Kiosko: eliminar barra de menú (File, Edit, View…)
    Menu.setApplicationMenu(null);

    // In development, load the Vite dev server
    // In production, load the Express server (which serves the static SPA)
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadURL('http://localhost:3000');
    }

    // Force Logout Quirúrgico: Solo borra ag_user (sesión operador).
    // Preserva ag_terminal_config (vínculo PC ↔ Garaje, permanente).
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.executeJavaScript(`
            localStorage.removeItem('ag_user');
            console.log('🧹 Force Logout: ag_user eliminado. ag_terminal_config preservado.');
        `).catch(err => console.warn('⚠️ Force Logout script error:', err));
    });

    // Atajos de teclado globales (F11 = fullscreen, Esc = salir de fullscreen)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        if (input.key === 'F11') {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
            event.preventDefault();
        } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
            mainWindow.setFullScreen(false);
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
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
