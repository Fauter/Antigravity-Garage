import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDB } from '../database/mongodb.js';

console.log('🚀 [BACKEND] Proceso de arranque iniciado...');

export const startServer = async () => {
    const app = express();

    // 1. CORS Middleware
    app.use(cors({
        origin: 'http://localhost:5173',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization']
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
    const { SyncService } = await import('../../modules/Sync/application/SyncService.js');

    // Configuration Module Routes
    const { default: configRoutes } = await import('../../modules/Configuration/http/routes.js');

    const accessController = new AccessController();
    const garageController = new GarageController();
    const authController = new AuthController();
    const syncService = new SyncService();

    // Mount Configuration Routes
    app.use('/api', configRoutes);

    // Access Control
    app.post('/api/estadias/entrada', accessController.registerEntry.bind(accessController));
    app.post('/api/estadias/salida', accessController.registerExit.bind(accessController));
    app.get('/api/estadias/activa/:plate', accessController.getActiveStay.bind(accessController));
    app.get('/api/estadias', accessController.getAllActiveStays.bind(accessController));

    // Garage Management
    app.get('/api/cocheras', garageController.getAllCocheras.bind(garageController));

    // Subscriptions logic
    app.get('/api/abonos', garageController.getSubscriptions ? garageController.getSubscriptions.bind(garageController) : (r, s) => s.status(404).send('Method not found'));
    app.post('/api/abonos', garageController.createSubscription ? garageController.createSubscription.bind(garageController) : (r, s) => s.status(404).send('Method not found'));

    // Customers & Vehicles
    app.get('/api/clientes/:id', garageController.getCustomerById ? garageController.getCustomerById.bind(garageController) : (r, s) => s.status(404).send());
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

    // Sync Bootstrap Endpoint (Explicit)
    app.post('/api/sync/bootstrap', async (req, res) => {
        const { garageId } = req.body;
        if (!garageId) return res.status(400).json({ error: 'garageId required' });

        // Safety Check: Only sync if DB is connected, otherwise we risk errors (or just rely on Supabase if SyncService supported it, but SyncService writes to Mongo)
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                message: 'Local Database Offline. Cannot sync to local cache.',
                mode: 'Cloud-Only'
            });
        }

        console.log(`🔌 Manual Sync Triggered for ${garageId}`);
        // Non-blocking
        syncService.pullAllData(garageId).then(() => {
            syncService.initRealtime(garageId);
        }).catch(err => console.error('Sync Error', err));

        res.json({ message: 'Sync started' });
    });


    // --- Start Server (Non-blocking DB) ---
    const PORT = process.env.PORT || 3000;

    httpServer.listen(PORT, async () => {
        console.log(`✅ Servidor GarageIA escuchando en http://localhost:${PORT}`);

        // --- ASYNC DATABASE INIT (Non-Blocking) ---
        (async () => {
            try {
                // Try to connect, but don't hold the server hostage
                await connectDB();

                if (mongoose.connection.readyState === 1) {
                    // Only wait for Hydration if we have a DB.
                    // Actually, we don't Hydrate automatically anymore, we wait for Login.
                    console.log('⏳ Sistema listo. Esperando Login para sincronizar.');
                } else {
                    console.log('⚠️ Sistema iniciado en modo CLOUD-ONLY (Sin caché local).');
                }

            } catch (dbError: any) {
                // This catch might not be reached if connectDB handles its own errors, 
                // but good for safety.
                console.warn('⚠️ Error crítico en inicialización de DB (Ignorado):', dbError.message);
            }
        })();
    });
};

startServer();
