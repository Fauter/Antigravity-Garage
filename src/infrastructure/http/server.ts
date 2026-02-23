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

    // Dynamic import
    const { AccessController } = await import('../../modules/AccessControl/infra/AccessController.js');
    const { GarageController } = await import('../../modules/Garage/infra/GarageController.js');
    const { AuthController } = await import('../../modules/Identity/infra/AuthController.js');
    const { syncService } = await import('../../modules/Sync/application/SyncService.js');

    // Configuration Module Routes
    const { default: configRoutes } = await import('../../modules/Configuration/http/routes.js');

    const accessController = new AccessController();
    const garageController = new GarageController();
    const authController = new AuthController();
    // syncService is already instantiated

    // Mount Configuration Routes
    app.use('/api', configRoutes);

    // Access Control
    app.post('/api/estadias/entrada', accessController.registerEntry.bind(accessController));
    app.post('/api/estadias/salida', accessController.registerExit.bind(accessController));
    app.get('/api/estadias/activa/:plate', accessController.getActiveStay.bind(accessController));
    app.get('/api/estadias', accessController.getAllActiveStays.bind(accessController));

    // Garage Management
    app.get('/api/cocheras', garageController.getAllCocheras.bind(garageController));
    app.post('/api/cocheras', garageController.createCochera.bind(garageController));
    app.patch('/api/cocheras/:id', garageController.updateCochera.bind(garageController));

    // Subscriptions logic
    app.get('/api/abonos', garageController.getSubscriptions ? garageController.getSubscriptions.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/abonos', garageController.createSubscription ? garageController.createSubscription.bind(garageController) : (r, s) => s.status(404).send('Method not found'));

    // Customers & Vehicles
    app.get('/api/clientes', garageController.findClientByDni ? garageController.findClientByDni.bind(garageController) : (r, s) => s.status(404).send());
    app.post('/api/clientes', garageController.createClient ? garageController.createClient.bind(garageController) : (r, s) => s.status(404).send());
    app.get('/api/clientes/:id', garageController.getCustomerById ? garageController.getCustomerById.bind(garageController) : (r, s) => s.status(404).send());
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
    app.post('/api/auth/login', authController.login.bind(authController));

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

    // --- Start Server ---
    const PORT = process.env.PORT || 3000;

    httpServer.listen(PORT, async () => {
        console.log(`✅ Servidor GarageIA escuchando en http://localhost:${PORT}`);
        console.log(`✅ Base de Datos Local: LISTA (Archivo ./.data/)`);
    });
};

startServer();
