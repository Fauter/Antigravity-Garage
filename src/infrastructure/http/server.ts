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

        app.use(express.json({ limit: '10mb' }));

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
        app.post('/api/estadias/cotizar', (req, res) => {
            if (accessController?.quoteExit) return accessController.quoteExit(req, res);
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

        // Recent Stays (for Reprint Center — returns last 20 stays, active OR closed)
        app.get('/api/estadias/recientes', async (req, res) => {
            try {
                const garageId = (req.headers['x-garage-id'] as string);
                if (!garageId) return res.status(400).json({ error: 'x-garage-id header required' });

                const allStays: any[] = await db.stays.find({ garageId });
                const sorted = allStays
                    .sort((a: any, b: any) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
                    .slice(0, 20);

                res.json(sorted);
            } catch (error: any) {
                console.error('Error fetching recent stays:', error);
                res.status(500).json({ error: error.message });
            }
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
        app.patch('/api/abonos/:id', (req, res) => {
            if (garageController?.updateSubscription) return garageController.updateSubscription(req, res);
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

        // Background Sync Endpoint (Silent)
        app.post('/api/sync/background', async (req, res) => {
            const { garageId } = req.body;
            if (!garageId) return res.status(400).json({ error: 'garageId required' });

            console.log(`🤫 Background Sync Triggered for ${garageId}`);
            if (syncService?.pullAllData) {
                // Pass true for isSilent
                try {
                    await syncService.pullAllData(garageId, true);
                } catch (err) {
                    console.error('Background Sync Error', err);
                    return res.status(500).json({ error: 'Background sync failed' });
                }
            }

            res.json({ message: 'Background sync finished' });
        });

        // Check Sync Status Endpoint
        app.get('/api/sync/check', (req, res) => {
            res.json({ syncing: syncService?.isGlobalSyncing || false });
        });

        // ── Hardware Integration Routes ──────────────────────────

        // Check exit authorization (used by barrier driver / simulator)
        app.get('/api/hardware/check-exit/:ticketCode', async (req, res) => {
            try {
                const normalizedCode = req.params.ticketCode.trim().toUpperCase();

                // Search ALL stays with this ticket_code (not just active ones!)
                // After payment: active=false, exit_authorized=true
                let candidates: any[] = await db.stays.find({ ticket_code: normalizedCode } as any);

                // Fallback: case-insensitive search
                if (candidates.length === 0) {
                    const allStays: any[] = await db.stays.find({});
                    candidates = allStays.filter((s: any) =>
                        s.ticket_code && s.ticket_code.toUpperCase() === normalizedCode
                    );
                }

                if (candidates.length === 0) {
                    return res.json({ authorized: false, reason: 'NOT_FOUND', ticketCode: normalizedCode });
                }

                // Most recent stay wins (prevents old ticket reuse)
                const stay: any = candidates.sort((a: any, b: any) =>
                    new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
                )[0];

                if (stay.barrier_exit_used === true) {
                    return res.json({ authorized: false, reason: 'ALREADY_USED', ticketCode: normalizedCode, plate: stay.plate });
                }

                if (stay.exit_authorized === true || stay.isSubscriber || stay.is_subscriber) {
                    const reason = (stay.isSubscriber || stay.is_subscriber) ? 'SUBSCRIBER' : 'PAID';
                    return res.json({ authorized: true, reason, ticketCode: normalizedCode, stayId: stay.id, plate: stay.plate });
                }

                res.json({ authorized: false, reason: 'NOT_PAID', ticketCode: normalizedCode, plate: stay.plate });
            } catch (error: any) {
                console.error('❌ Hardware check-exit error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // ── RFID Authorization (Salida Pre-Autorizada) ─────────────────
        // Flow: cashier processes payment → backend sets exit_authorized=true, active=false
        //       → client drives to exit → scans RFID → this endpoint validates
        //
        // Logic:
        //   1. Find vehicle by rfid_tag in vehicles table
        //   2. If subscriber → auto-authorize (they have perpetual access)
        //   3. If hourly → find MOST RECENT stay for that plate (may be active=false after payment)
        //      → check exit_authorized=true AND barrier_exit_used != true
        //   4. If not found → reject
        app.get('/api/hardware/check-rfid/:rfidCode', async (req, res) => {
            try {
                const rfidCode = req.params.rfidCode.trim().toUpperCase();

                // ── Step 1: Find vehicle by RFID tag ──
                const vehicles: any[] = await db.vehicles?.find({ rfid_tag: rfidCode } as any) ?? [];

                if (vehicles.length === 0) {
                    // No vehicle registered with this RFID tag
                    return res.json({ authorized: false, reason: 'NOT_FOUND', rfidCode });
                }

                const vehicle = vehicles[0];
                const plate = vehicle.plate;

                // ── Step 2: Subscribers auto-authorize ──
                // Subscribers may or may not have an active stay, but their tag always works
                if (vehicle.is_subscriber === true) {
                    // Check for anti-passback: find any stay with barrier_exit_used
                    const subscriberStays: any[] = await db.stays.find({
                        plate,
                        active: true,
                    } as any);

                    const activeStay = subscriberStays.sort((a: any, b: any) =>
                        new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
                    )[0];

                    if (activeStay?.barrier_exit_used === true) {
                        return res.json({ authorized: false, reason: 'ALREADY_USED', rfidCode, plate });
                    }

                    return res.json({
                        authorized: true,
                        reason: 'SUBSCRIBER',
                        rfidCode,
                        stayId: activeStay?.id ?? null,
                        plate,
                    });
                }

                // ── Step 3: Hourly vehicle — find most recent stay (may be closed after payment) ──
                // After payment: the backend sets active=false, exit_authorized=true
                // We search ALL stays for this plate, sorted by entry time DESC
                const allStays: any[] = await db.stays.find({ plate } as any);

                if (allStays.length === 0) {
                    return res.json({ authorized: false, reason: 'NOT_FOUND', rfidCode, plate });
                }

                const latestStay = allStays.sort((a: any, b: any) =>
                    new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
                )[0];

                // Anti-passback: already exited with this stay
                if (latestStay.barrier_exit_used === true) {
                    return res.json({ authorized: false, reason: 'ALREADY_USED', rfidCode, plate });
                }

                // Check if the stay was authorized for exit (payment processed)
                if (latestStay.exit_authorized === true) {
                    return res.json({
                        authorized: true,
                        reason: 'PAID',
                        rfidCode,
                        stayId: latestStay.id,
                        plate,
                    });
                }

                // Check legacy subscriber flags on the stay itself
                if (latestStay.is_subscriber === true || latestStay.isSubscriber === true) {
                    return res.json({
                        authorized: true,
                        reason: 'SUBSCRIBER',
                        rfidCode,
                        stayId: latestStay.id,
                        plate,
                    });
                }

                // Stay exists but not yet paid
                return res.json({ authorized: false, reason: 'NOT_PAID', rfidCode, plate });
            } catch (error: any) {
                console.error('❌ Hardware check-rfid error:', error);
                res.status(500).json({ authorized: false, reason: 'ERROR', rfidCode: req.params.rfidCode, error: error.message });
            }
        });

        // Mark stay as exit-used for anti-passback
        app.patch('/api/hardware/mark-exit-used/:stayId', async (req, res) => {
            try {
                const stayId = req.params.stayId;
                const { barrier_exit_used, barrier_exit_at } = req.body;

                await db.stays.update(
                    { id: stayId } as any,
                    { $set: { barrier_exit_used, barrier_exit_at: barrier_exit_at ? new Date(barrier_exit_at) : new Date() } } as any,
                    {} as any
                );

                res.json({ success: true, stayId });
            } catch (error: any) {
                console.error('❌ Hardware mark-exit-used error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get pending hardware entries
        app.get('/api/hardware/pending-entries', async (req, res) => {
            try {
                const garageId = (req.headers['x-garage-id'] as string);
                const query: any = { is_pending_processing: true };
                if (garageId) query.garageId = garageId;

                const pending = await db.stays.find(query);
                res.json(pending);
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
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
