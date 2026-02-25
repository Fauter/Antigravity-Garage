import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Mongoose removed. Zero-Install Arch.
import { SUPABASE_URL } from '../lib/supabase.js';

console.log('🚀 [BACKEND] Proceso de arranque iniciado (Modo: Zero-Install / Offline-First)...');
console.log(`🔗 Conectado a Supabase en: ${SUPABASE_URL}`);

export const startServer = async () => {
    const app = express();

    // 1. CORS Middleware
    app.use(cors({
        origin: 'http://localhost:5173',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-garage-id']
    }));

    app.use(express.json());

    const httpServer = createServer(app);
    const io = new Server(httpServer, {
        cors: {
            origin: "http://localhost:5173",
            methods: ["GET", "POST", "PATCH"]
        }
    });

    // --- API Routes & Controllers ---

    // Dynamic import (Robust extraction to handle tsx / node ESM differences)
    const accessMod = await import('../../modules/AccessControl/infra/AccessController.js');
    const AccessControllerClass = accessMod.AccessController || (accessMod.default && accessMod.default.AccessController);

    const { GarageController: GarageControllerClass } = await import('../../modules/Garage/infra/GarageController.js');

    const authMod = await import('../../modules/Identity/infra/AuthController.js');
    const AuthControllerClass = authMod.AuthController || (authMod.default && authMod.default.AuthController);

    const syncMod = await import('../../modules/Sync/application/SyncService.js');
    const syncService = syncMod.syncService || (syncMod.default && syncMod.default.syncService);

    // Configuration Module Routes
    const configModule = await import('../../modules/Configuration/http/routes.js');
    const configRoutes = configModule.default || configModule.router;

    const accessController = new AccessControllerClass();
    const garageController = new GarageControllerClass();
    const authController = new AuthControllerClass();
    // syncService is already instantiated

    // Mount Configuration Routes
    app.use('/api', configRoutes);

    // Access Control
    app.post('/api/estadias/entrada', accessController.registerEntry ? accessController.registerEntry.bind(accessController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/estadias/salida', accessController.registerExit ? accessController.registerExit.bind(accessController) : (r, s) => s.status(404).send('Method not found'));
    app.get('/api/estadias/activa/:plate', accessController.getActiveStay ? accessController.getActiveStay.bind(accessController) : (r, s) => s.status(404).send('Method not found'));
    app.get('/api/estadias', accessController.getAllActiveStays ? accessController.getAllActiveStays.bind(accessController) : (r, s) => s.status(404).send('Method not found'));

    // Garage Management
    app.get('/api/cocheras', garageController.getAllCocheras ? garageController.getAllCocheras.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/cocheras', garageController.createCochera ? garageController.createCochera.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.patch('/api/cocheras/:id', garageController.updateCochera ? garageController.updateCochera.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/cocheras/desvincular-vehiculo', garageController.unassignVehicle ? garageController.unassignVehicle.bind(garageController) : (r, s) => s.status(404).send());
    app.post('/api/cocheras/liberar', garageController.releaseCochera ? garageController.releaseCochera.bind(garageController) : (r, s) => s.status(404).send());

    // Subscriptions logic
    app.get('/api/abonos', garageController.getSubscriptions ? garageController.getSubscriptions.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/abonos', garageController.createSubscription ? garageController.createSubscription.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/abonos/alta-completa', garageController.createFullSubscription ? garageController.createFullSubscription.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/abonos/renovar', garageController.renewSubscription ? garageController.renewSubscription.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/abonos/evaluar-deudas', garageController.triggerDebtSweep ? garageController.triggerDebtSweep.bind(garageController) : (r, s) => s.status(404).send('Method not found'));

    // Customers & Vehicles
    app.get('/api/clientes', garageController.findClientByDni ? garageController.findClientByDni.bind(garageController) : (r, s) => s.status(404).send());
    app.post('/api/clientes', garageController.createClient ? garageController.createClient.bind(garageController) : (r, s) => s.status(404).send());
    app.get('/api/clientes/:id', garageController.getCustomerById ? garageController.getCustomerById.bind(garageController) : (r, s) => s.status(404).send());
    app.get('/api/deudas/:clientId', garageController.getDebtsByCustomer ? garageController.getDebtsByCustomer.bind(garageController) : (r, s) => s.status(404).send());
    app.get('/api/vehiculos', garageController.getVehicles ? garageController.getVehicles.bind(garageController) : (r, s) => s.status(404).send());

    app.get('/api/vehiculos/:plate', garageController.getVehicleByPlate ? garageController.getVehicleByPlate.bind(garageController) : (r, s) => s.status(404).send());
    app.patch('/api/clientes/:id', garageController.updateCustomer ? garageController.updateCustomer.bind(garageController) : (r, s) => s.status(404).send());

    // Billing
    app.get('/api/caja/movimientos', garageController.getMovements ? garageController.getMovements.bind(garageController) : (r, s) => s.status(404).send());
    app.post('/api/caja/movimientos', garageController.createMovement ? garageController.createMovement.bind(garageController) : (r, s) => s.status(404).send());

    // Shift Management
    app.post('/api/caja/apertura', garageController.openShift ? garageController.openShift.bind(garageController) : (r, s) => s.status(404).send());
    app.post('/api/caja/cierre', garageController.closeShift ? garageController.closeShift.bind(garageController) : (r, s) => s.status(404).send());
    app.get('/api/caja/turno-actual', garageController.getCurrentShift ? garageController.getCurrentShift.bind(garageController) : (r, s) => s.status(404).send());

    // Auth Routes
    app.post('/api/auth/login', authController.login ? authController.login.bind(authController) : (r, s) => s.status(404).send('Method not found'));

    // Sync Bootstrap Endpoint
    app.post('/api/sync/bootstrap', async (req, res) => {
        const { garageId } = req.body;
        if (!garageId) return res.status(400).json({ error: 'garageId required' });

        console.log(`🔌 Manual Sync Triggered for ${garageId}`);
        syncService.pullAllData(garageId).then(() => {
            syncService.initRealtime(garageId);
        }).catch(err => console.error('Sync Error', err));

        res.json({ message: 'Sync started' });
    });

    // Check Sync Status Endpoint
    app.get('/api/sync/check', (req, res) => {
        res.json({ syncing: syncService.isGlobalSyncing });
    });

    // --- Start Server ---
    const PORT = process.env.PORT || 3000;

    httpServer.listen(PORT, async () => {
        console.log(`✅ Servidor GarageIA escuchando en http://localhost:${PORT}`);
        console.log(`✅ Base de Datos Local: LISTA (Archivo ./.data/)`);
    });
};

startServer();
