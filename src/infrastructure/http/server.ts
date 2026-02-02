import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { connectDB } from '../database/mongodb';
import { connectDB } from '../database/mongodb';

console.log('🚀 [BACKEND] Proceso de arranque iniciado...');

export const startServer = async () => {
    const app = express();

    // 1. CORS Middleware - MUST BE FIRST
    app.use(cors({
        origin: 'http://localhost:5173',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    app.use(express.json());

    const httpServer = createServer(app);
    const io = new Server(httpServer, {
        cors: {
            origin: "http://localhost:5173",
            methods: ["GET", "POST"]
        }
    });

    // --- API Routes ---

    // Dynamic import to avoid circular dependencies
    // Dynamic import to avoid circular dependencies
    const { AccessController } = await import('../../modules/AccessControl/infra/AccessController');
    const { GarageController } = await import('../../modules/Garage/infra/GarageController');
    const { AuthController } = await import('../../modules/Identity/infra/AuthController');

    const accessController = new AccessController();
    const garageController = new GarageController();
    const authController = new AuthController();

    // Access Control (Estadías)
    // Access Control (Estadías)
    app.post('/api/estadias/entrada', accessController.registerEntry.bind(accessController));
    app.post('/api/estadias/salida', accessController.registerExit.bind(accessController));
    app.get('/api/estadias/activa/:plate', accessController.getActiveStay.bind(accessController));
    app.get('/api/estadias', accessController.getAllActiveStays.bind(accessController));

    // Auth
    app.post('/api/auth/login', authController.login.bind(authController));

    // Caja / Billing
    app.get('/api/movimientos', accessController.getAllMovements.bind(accessController));

    // Config & Reset
    app.post('/api/config/reset', async (req, res) => {
        try {
            console.log('⚠️ RESET SOLICITADO. Limpiando Base de Datos...');

            // Usar las instancias activas de los controladores para limpiar RAM y Disco
            // AccessController maneja StayRepository y MovementRepository
            // GarageController maneja SubscriptionRepository

            await accessController.reset();
            await garageController.reset();

            // Note: accessController.reset() clears both stays and movements
            // garageController.reset() clears subscriptions


            console.log('🗑️ Base de datos (Abonos, Movimientos, Estadías) reiniciada.');

            res.json({ message: 'Base de datos reiniciada correctamente' });
        } catch (error: any) {
            console.error('Reset Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Garage / Subscriptions (Abonos)
    app.post('/api/abonos', garageController.createSubscription.bind(garageController));
    app.get('/api/abonos', garageController.getAllSubscriptions.bind(garageController));


    app.post('/api/sync', async (req, res) => {
        try {
            const mutations = req.body;
            if (!Array.isArray(mutations)) {
                return res.status(400).json({ error: 'Payload must be an array of mutations' });
            }

            console.log(`📥 Recibiendo ${mutations.length} mutaciones para sync...`);

            const { SyncService } = await import('../../modules/Sync/application/SyncService');
            const syncService = new SyncService();

            const result = await syncService.processMutations(mutations);

            console.log(`✅ Sync completado. Procesados: ${result.processed}, Conflictos: ${result.conflicts}`);
            res.json(result);
        } catch (error: any) {
            console.error('❌ Error en /api/sync:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // --- Socket.io Events ---
    io.on('connection', (socket) => {
        console.log(`🔌 Cliente conectado: ${socket.id}`);

        socket.on('disconnect', () => {
            console.log(`🔌 Cliente desconectado: ${socket.id}`);
        });
    });

    // --- Start Server FIRST (Non-blocking) ---
    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, () => {
        console.log(`✅ Servidor GarageIA escuchando en http://localhost:${PORT}`);

        // Connect to DB AFTER server is listening
        // connectDB().catch(error => {
        //     console.error('❌ Error crítico de Base de Datos: ' + error.message);
        // });
        console.log('📦 Base de Datos Local: Activada (JSON Files)');

        // Start Watcher
        // Disabled for Local JSON mode to prevent Replica Set errors
        console.log('👀 Change Stream: Desactivado (Modo Local JSON)');
    });

    return httpServer;
};

// Execute immediately
startServer();
