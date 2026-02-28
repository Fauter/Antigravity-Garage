import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { db } from '../database/datastore.js';
import { QueueService } from '../../modules/Sync/application/QueueService.js';

// Mongoose removed. Zero-Install Arch.
import { SUPABASE_URL } from '../lib/supabase';
import fs from 'fs';

console.log('🚀 [BACKEND] Proceso de arranque iniciado (Modo: Zero-Install / Offline-First)...');
console.log(`🔗 Conectado a Supabase en: ${SUPABASE_URL}`);

export const startServer = async () => {
    try {
        const app = express();
        const isPackaged = (process as any).resourcesPath !== undefined && !process.env.NODE_ENV;

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

        // Decisive loader: uses require() in production to avoid ESM engine triggering
        async function loadModule(modulePath: string) {
            try {
                if (isPackaged) {
                    // In production, we assume CommonJS (dist_main)
                    const absolutePath = path.resolve(__dirname, modulePath);
                    // @ts-ignore - Dynamic require is necessary for the packaged environment
                    const mod = require(absolutePath);
                    return mod.default || mod;
                } else {
                    // In development, dynamic import or require could both work, but tsx prefers import
                    const mod = await import(modulePath);
                    return mod.default || mod;
                }
            } catch (err: any) {
                console.error(`❌ [SERVER] Error cargando módulo ${modulePath}:`, err);
                return null;
            }
        }

        // --- Universal Named-Export Extractor ---
        // All three controllers use `export class ClassName` (named export, no `export default`).
        // In CJS (packaged), require() returns { ClassName: [Function] }.
        // In ESM (dev), dynamic import() returns the same shape.
        // Priority: named export by known key > .default > module itself (last resort).
        const accessMod = await loadModule('../../modules/AccessControl/infra/AccessController.js');
        const garageMod = await loadModule('../../modules/Garage/infra/GarageController.js');
        const authMod = await loadModule('../../modules/Identity/infra/AuthController.js');
        const syncMod = await loadModule('../../modules/Sync/application/SyncService.js');

        const AccessControllerClass = accessMod?.AccessController ?? accessMod?.default?.AccessController ?? accessMod?.default ?? accessMod;
        const GarageControllerClass = garageMod?.GarageController ?? garageMod?.default?.GarageController ?? garageMod?.default ?? garageMod;
        const AuthControllerClass = authMod?.AuthController ?? authMod?.default?.AuthController ?? authMod?.default ?? authMod;
        const syncService = syncMod?.syncService ?? syncMod?.default?.syncService ?? syncMod?.default ?? syncMod;

        // Configuration Module Routes
        const configRoutes = await loadModule('../../modules/Configuration/http/routes.js');

        // --- Type Guards before instantiation ---
        // If a class fails to resolve, we log a descriptive error but don't crash the sync process.
        function safeInstantiate<T>(Class: any, name: string): T | null {
            if (typeof Class !== 'function') {
                console.error(`❌ [SERVER] '${name}' no es un constructor. Módulo recibido:`, typeof Class, Class);
                return null;
            }
            try {
                return new Class() as T;
            } catch (err) {
                console.error(`❌ [SERVER] Error al instanciar '${name}':`, err);
                return null;
            }
        }

        const accessController = safeInstantiate<any>(AccessControllerClass, 'AccessController');
        const garageController = safeInstantiate<any>(GarageControllerClass, 'GarageController');
        const authController = safeInstantiate<any>(AuthControllerClass, 'AuthController');

        // Mount Configuration Routes
        if (configRoutes) app.use('/api', configRoutes as any);

        // --- Route Bindings with Safe Guards ---

        // Financial Config
        app.get('/api/configuracion-financiera', (req, res) => {
            if (garageController?.getFinancialConfig) return garageController.getFinancialConfig(req, res);
            res.status(404).json({ error: 'Method not available' });
        });

        // Access Control
        app.post('/api/estadias/entrada', (req, res) => {
            if (accessController?.registerEntry) return accessController.registerEntry(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/estadias/salida', (req, res) => {
            if (accessController?.registerExit) return accessController.registerExit(req, res);
            res.status(404).send('Method not found');
        });
        app.get('/api/estadias/activa/:plate', (req, res) => {
            if (accessController?.getActiveStay) return accessController.getActiveStay(req, res);
            res.status(404).send('Method not found');
        });
        app.get('/api/estadias', (req, res) => {
            if (accessController?.getAllActiveStays) return accessController.getAllActiveStays(req, res);
            res.status(404).send('Method not found');
        });

        // Garage Management
        app.get('/api/cocheras', (req, res) => {
            if (garageController?.getAllCocheras) return garageController.getAllCocheras(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/cocheras', (req, res) => {
            if (garageController?.createCochera) return garageController.createCochera(req, res);
            res.status(404).send('Method not found');
        });
        app.patch('/api/cocheras/:id', (req, res) => {
            if (garageController?.updateCochera) return garageController.updateCochera(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/cocheras/desvincular-vehiculo', (req, res) => {
            if (garageController?.unassignVehicle) return garageController.unassignVehicle(req, res);
            res.status(404).send();
        });
        app.post('/api/cocheras/liberar', (req, res) => {
            if (garageController?.releaseCochera) return garageController.releaseCochera(req, res);
            res.status(404).send();
        });

        // Subscriptions logic
        app.get('/api/abonos', (req, res) => {
            if (garageController?.getSubscriptions) return garageController.getSubscriptions(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/abonos', (req, res) => {
            if (garageController?.createSubscription) return garageController.createSubscription(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/abonos/alta-completa', (req, res) => {
            if (garageController?.createFullSubscription) return garageController.createFullSubscription(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/abonos/renovar', (req, res) => {
            if (garageController?.renewSubscription) return garageController.renewSubscription(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/abonos/evaluar-deudas', (req, res) => {
            if (garageController?.triggerDebtSweep) return garageController.triggerDebtSweep(req, res);
            res.status(404).send('Method not found');
        });

        // Customers & Vehicles
        app.get('/api/clientes', (req, res) => {
            if (garageController?.findClientByDni) return garageController.findClientByDni(req, res);
            res.status(404).send();
        });
        app.post('/api/clientes', (req, res) => {
            if (garageController?.createClient) return garageController.createClient(req, res);
            res.status(404).send();
        });
        app.get('/api/clientes/:id', (req, res) => {
            if (garageController?.getCustomerById) return garageController.getCustomerById(req, res);
            res.status(404).send();
        });
        app.get('/api/deudas/:clientId', (req, res) => {
            if (garageController?.getDebtsByCustomer) return garageController.getDebtsByCustomer(req, res);
            res.status(404).send();
        });
        app.get('/api/vehiculos', (req, res) => {
            if (garageController?.getVehicles) return garageController.getVehicles(req, res);
            res.status(404).send();
        });

        app.get('/api/vehiculos/:plate', (req, res) => {
            if (garageController?.getVehicleByPlate) return garageController.getVehicleByPlate(req, res);
            res.status(404).send();
        });
        app.patch('/api/clientes/:id', (req, res) => {
            if (garageController?.updateCustomer) return garageController.updateCustomer(req, res);
            res.status(404).send();
        });

        // Billing
        app.get('/api/caja/movimientos', (req, res) => {
            if (garageController?.getMovements) return garageController.getMovements(req, res);
            res.status(404).send();
        });
        app.post('/api/caja/movimientos', (req, res) => {
            if (garageController?.createMovement) return garageController.createMovement(req, res);
            res.status(404).send();
        });

        // Incidents Management
        app.post('/api/incidents', async (req, res) => {
            try {
                const incident = req.body;
                console.log('📥 [Server /api/incidents] Payload recibido:', JSON.stringify(incident));

                if (!incident || !incident.id) {
                    return res.status(400).json({ error: 'Payload inválido: falta id' });
                }

                // Sanitizar: eliminar campos null/undefined antes de NeDB
                const cleanIncident: any = {};
                for (const [key, value] of Object.entries(incident)) {
                    if (value !== null && value !== undefined) {
                        cleanIncident[key] = value;
                    }
                }

                // 1. Guardar en NeDB local
                await db.incidents.insert(cleanIncident);
                console.log('✅ [Server] Incidente guardado en NeDB local');

                // 2. Encolar para Supabase — IMPORTANTE: Usar 'Incident' (PascalCase)
                // para que coincida con el tableMap del SyncService
                const queue = new QueueService();
                await queue.enqueue('Incident', 'CREATE', cleanIncident);
                console.log('✅ [Server] Incidente encolado como mutación tipo "Incident"');

                res.status(201).json({ success: true });
            } catch (error) {
                console.error('❌ [Server] Error en /api/incidents:', error);
                res.status(500).json({ error: 'Error interno al guardar incidente' });
            }
        });

        // Promos (Read-Only from Sync)
        app.get('/api/promos', async (req, res) => {
            try {
                const garageId = req.headers['x-garage-id'] as string;
                if (!garageId) return res.status(400).json({ error: 'x-garage-id header required' });

                const promos = await db.promos.find({ garageId, activo: true });
                res.json(promos);
            } catch (error) {
                console.error('❌ Error fetching promos:', error);
                res.status(500).json({ error: 'Error interno' });
            }
        });

        // Shift Management
        app.post('/api/caja/apertura', (req, res) => {
            if (garageController?.openShift) return garageController.openShift(req, res);
            res.status(404).send();
        });
        app.post('/api/caja/cierre', (req, res) => {
            if (garageController?.closeShift) return garageController.closeShift(req, res);
            res.status(404).send();
        });
        app.post('/api/caja/cierre-parcial', (req, res) => {
            if (garageController?.partialClose) return garageController.partialClose(req, res);
            res.status(404).send();
        });
        app.get('/api/caja/cierres-parciales', (req, res) => {
            if (garageController?.getPartialCloses) return garageController.getPartialCloses(req, res);
            res.status(404).send();
        });
        app.get('/api/caja/cierres', (req, res) => {
            if (garageController?.getShiftCloses) return garageController.getShiftCloses(req, res);
            res.status(404).send();
        });
        app.get('/api/caja/turno-actual', (req, res) => {
            if (garageController?.getCurrentShift) return garageController.getCurrentShift(req, res);
            res.status(404).send();
        });

        // Auth Routes
        app.post('/api/auth/login', (req, res) => {
            if (authController?.login) return authController.login(req, res);
            res.status(404).send('Method not found');
        });

        // Sync Bootstrap Endpoint
        app.post('/api/sync/bootstrap', async (req, res) => {
            const { garageId } = req.body;
            if (!garageId) return res.status(400).json({ error: 'garageId required' });

            console.log(`🔌 Manual Sync Triggered for ${garageId}`);
            if (syncService?.pullAllData) {
                syncService.pullAllData(garageId).then(() => {
                    syncService.initRealtime(garageId);
                }).catch((err: any) => console.error('Sync Error', err));
            }

            res.json({ message: 'Sync started' });
        });

        // Check Sync Status Endpoint
        app.get('/api/sync/check', (req, res) => {
            res.json({ syncing: syncService?.isGlobalSyncing || false });
        });

        // --- 2. Production Static Files & Robust Path Resolution (Moved to after API) ---
        let frontendDist = isPackaged
            ? path.join((process as any).resourcesPath, 'app.asar', 'src', 'frontend', 'dist')
            : path.join(__dirname, '..', '..', '..', '..', 'src', 'frontend', 'dist');

        if (!fs.existsSync(frontendDist)) {
            frontendDist = path.resolve(__dirname, '../../frontend/dist');
        }

        if (fs.existsSync(frontendDist)) {
            console.log(`✅ [PROD] Sirviendo Frontend desde: ${frontendDist}`);
            app.use(express.static(frontendDist));
            app.use((req, res, next) => {
                if (req.path.startsWith('/api')) return next();
                res.sendFile(path.join(frontendDist, 'index.html'));
            });
        }

        // --- Start Server ---
        const PORT = process.env.PORT || 3000;

        httpServer.listen(PORT, async () => {
            console.log(`✅ Servidor GarageIA escuchando en http://localhost:${PORT}`);
            console.log(`✅ Base de Datos Local: LISTA (Archivo ./.data/)`);
        });
    } catch (err) {
        console.error('❌ Error fatal en startServer:', err);
    }
};

startServer().catch(err => console.error('❌ Error en la promesa de arranque:', err));
