const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Start the backend server
const fs = require('fs');

const startServer = () => {
    console.log('🚀 [ELECTRON] Iniciando proceso de orquestación del Backend...');

    let serverPath;
    if (isDev) {
        console.log('🛠️ [DEV] Registrando transpiler tsx para ejecución directa...');
        // Register tsx to handle .ts files in development
        try {
            require('tsx/register');
            serverPath = path.join(__dirname, 'src/infrastructure/http/server.ts');
        } catch (e) {
            console.error('❌ Error: El paquete "tsx" es necesario en desarrollo.');
            return;
        }
    } else {
        console.log('📦 [PROD] Cargando servidor pre-compilado...');
        serverPath = path.join(__dirname, 'dist_main/infrastructure/http/server.js');
    }

    console.log(`🔍 Validando existencia del servidor en: ${serverPath}`);
    if (fs.existsSync(serverPath)) {
        try {
            require(serverPath);
            console.log('✅ Servidor cargado exitosamente.');
        } catch (err) {
            console.error(`❌ Error crítico al ejecutar el servidor:`, err);
        }
    } else {
        console.error(`❌ ERROR CRÍTICO: No se encontró el punto de entrada del servidor en: ${serverPath}`);
        console.error('Asegúrate de ejecutar "npm run build:backend" antes de empaquetar.');
    }
};

startServer();

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "GarageIA - Control de Estacionamiento",
        icon: path.join(__dirname, 'src/frontend/public/vite.svg'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // Required for some native modules or older patterns, but we'll keep it flexible
            enableRemoteModule: true
        }
    });

    // In development, load the Vite dev server
    // In production, load the Express server (which should serve the static files)
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // mainWindow.webContents.openDevTools();
    } else {
        // In production, we point to the local express server
        mainWindow.loadURL('http://localhost:3000');
    }

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
