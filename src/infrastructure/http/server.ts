import { OpsLogger } from '../../shared/OpsLogger';

// Enable the console bridge immediately to capture all subsequent console.* calls
OpsLogger.installConsoleBridge();

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { db } from '../database/datastore.js';
import { QueueService } from '../../modules/Sync/application/QueueService.js';
import { SQLiteManager } from '../database/sqlite/SQLiteManager.js';
import { MigrationOrchestrator } from '../database/sqlite/MigrationOrchestrator.js';
import { createUnifiedHasLocalDataHandler, probeLocalDataUnified } from '../../modules/Sync/application/LocalDataProbe.js';

// Mongoose removed. Zero-Install Arch.
import { SUPABASE_URL } from '../lib/supabase.js';
import fs from 'fs';

import { StorageEngine } from '../database/StorageEngine.js';

export const startServer = async (port?: number) => {
    // -----------------------------------------------------
    // Phase 1.5 - Snapshot Consistency & Database Health Check
    // -----------------------------------------------------
    try {
        OpsLogger.infoText('STARTUP', 'Verificando salud DB local SQLite...');
        const activeEngine = StorageEngine.getEngine();
        const activeDbPath = SQLiteManager.getInstance().getDbPath();
        const isTestMode = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
        OpsLogger.infoText('STARTUP', `[OK] Storage Engine: ${activeEngine}`);
        OpsLogger.infoText('STARTUP', `[OK] SQLite Path: ${activeDbPath}`);
        OpsLogger.debug('STARTUP', `TEST MODE: ${isTestMode}`);
        
        // Bloqueamos el inicio del servidor hasta que el Shadow sea VALID o falle la validación,
        // asegurando que no entren requests HTTP que modifiquen NeDB durante el volcado.
        await MigrationOrchestrator.initializeShadow();
    } catch (e: any) {
        OpsLogger.errorText('STARTUP', '[ERR] FATAL DATABASE HEALTH ERROR al inicializar DB');
        OpsLogger.errorText('STARTUP', '[ERR]', { error: e });
        OpsLogger.errorText('STARTUP', '[ERR] Servidor no puede iniciar por DB corrupta. Abortando.');
        process.exit(1);
    }
    // -----------------------------------------------------

    OpsLogger.infoText('STARTUP', 'Proceso de arranque iniciado (Zero-Install/Offline-First)...');
    OpsLogger.infoText('STARTUP', `[CFG] Cliente Supabase inicializado (URL: ${SUPABASE_URL})`);

    try {
        const app = express();
        const isPackaged = (process as any).resourcesPath !== undefined && !process.env.NODE_ENV;

        // 1. CORS Middleware
        app.use(cors({
            origin: 'http://localhost:5173',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
            allowedHeaders: ['Content-Type', 'Authorization', 'x-garage-id'],
            exposedHeaders: ['x-terminal-config-status', 'x-terminal-config-source']
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
                OpsLogger.errorText('STARTUP', `[ERR] Error cargando módulo ${modulePath}`, { error: err });
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
                OpsLogger.errorText('STARTUP', `[ERR] '${name}' no es constructor`, { typeof: typeof Class, module: Class });
                return null;
            }
            try {
                return new Class() as T;
            } catch (err) {
                OpsLogger.errorText('STARTUP', `[ERR] Error instanciando '${name}'`, { error: err });
                return null;
            }
        }

        const accessController = safeInstantiate<any>(AccessControllerClass, 'AccessController');
        const garageController = safeInstantiate<any>(GarageControllerClass, 'GarageController');
        const authController = safeInstantiate<any>(AuthControllerClass, 'AuthController');

        // Mount Configuration Routes
        if (configRoutes && typeof configRoutes === 'function') app.use('/api', configRoutes); else if (configRoutes && typeof configRoutes.default === 'function') app.use('/api', configRoutes.default); else OpsLogger.errorText('STARTUP', '[ERR] Failed to load configRoutes', { configRoutes });

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

                const allStays: any[] = await (require('../database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase().prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?").all(garageId).map((r: any) => JSON.parse(r.json_data)));
                const sorted = allStays
                    .sort((a: any, b: any) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
                    .slice(0, 20);

                res.json(sorted);
            } catch (error: any) {
                OpsLogger.errorText('API', '[ERR] Error fetching recent stays', { error });
                res.status(500).json({ error: error.message });
            }
        });

        // Reprint Center API
        app.get('/api/reimpresion/buscar', async (req, res) => {
            try {
                const garageId = (req.headers['x-garage-id'] as string);
                if (!garageId) return res.status(400).json({ error: 'x-garage-id header required' });
                
                const limit = parseInt(req.query.limit as string) || 100;
                const offset = parseInt(req.query.offset as string) || 0;
                const search = req.query.search ? (req.query.search as string).toLowerCase().trim() : '';
                
                let stays: any[] = [];
                let movements: any[] = [];
                const extraStays: any[] = [];
                const extraMovs: any[] = [];

                if (StorageEngine.getEngine() === 'SQLITE') {
                    const sqlite = require('../database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase();
                    
                    // 1. Fetch Stays
                    let staysQuery = "SELECT json_data FROM stays WHERE (json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?)";
                    const staysParams: any[] = [garageId, garageId];
                    
                    if (search) {
                        staysQuery += " AND (LOWER(json_extract(json_data, '$.plate')) LIKE ? OR LOWER(json_extract(json_data, '$.ticket_code')) LIKE ?)";
                        staysParams.push(`%${search}%`, `%${search}%`);
                    }
                    staysQuery += " ORDER BY json_extract(json_data, '$.entryTime') DESC LIMIT ? OFFSET ?";
                    staysParams.push(limit, offset);
                    
                    stays = sqlite.prepare(staysQuery).all(...staysParams).map((r: any) => JSON.parse(r.json_data));
                    
                    // 2. Fetch Movements
                    let movsQuery = "SELECT json_data FROM movements WHERE (json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?)";
                    const movsParams: any[] = [garageId, garageId];
                    
                    movsQuery += " AND json_extract(json_data, '$.type') IN ('CobroEstadia', 'CobroAbono', 'Upgrade')";
                    
                    if (search) {
                        movsQuery += " AND (LOWER(json_extract(json_data, '$.plate')) LIKE ? OR LOWER(json_extract(json_data, '$.ticket_code')) LIKE ?)";
                        movsParams.push(`%${search}%`, `%${search}%`);
                    }
                    movsQuery += " ORDER BY json_extract(json_data, '$.timestamp') DESC LIMIT ? OFFSET ?";
                    movsParams.push(limit, offset);
                    
                    movements = sqlite.prepare(movsQuery).all(...movsParams).map((r: any) => JSON.parse(r.json_data));
                    
                    // 3. For all movements that are CobroEstadia, fetch their related stay
                    const stayIdsToFetch = new Set<string>();
                    movements.forEach((m: any) => {
                        if (m.type === 'CobroEstadia' && m.relatedEntityId) {
                            stayIdsToFetch.add(m.relatedEntityId);
                        } else if (m.type === 'CobroEstadia' && m.related_entity_id) {
                            stayIdsToFetch.add(m.related_entity_id);
                        }
                    });
                    
                    stays.forEach((s: any) => {
                        stayIdsToFetch.delete(s.id);
                        stayIdsToFetch.delete(s._id);
                    });
                    
                    if (stayIdsToFetch.size > 0) {
                        const placeholders = Array.from(stayIdsToFetch).map(() => '?').join(',');
                        const extraQuery = `SELECT json_data FROM stays WHERE json_extract(json_data, '$.id') IN (${placeholders}) OR json_extract(json_data, '$._id') IN (${placeholders})`;
                        const params = [...Array.from(stayIdsToFetch), ...Array.from(stayIdsToFetch)];
                        const extra = sqlite.prepare(extraQuery).all(...params).map((r: any) => JSON.parse(r.json_data));
                        extraStays.push(...extra);
                    }

                    const movIdsToFetch = new Set<string>();
                    stays.forEach((s: any) => {
                        if (s.is_prepaid && s.prepaid_movement_id) {
                            movIdsToFetch.add(s.prepaid_movement_id);
                        }
                    });
                    movements.forEach((m: any) => movIdsToFetch.delete(m.id));
                    if (movIdsToFetch.size > 0) {
                        const placeholders = Array.from(movIdsToFetch).map(() => '?').join(',');
                        const extraQuery = `SELECT json_data FROM movements WHERE json_extract(json_data, '$.id') IN (${placeholders})`;
                        const extra = sqlite.prepare(extraQuery).all(...Array.from(movIdsToFetch)).map((r: any) => JSON.parse(r.json_data));
                        extraMovs.push(...extra);
                    }
                } else {
                    const { db } = require('../database/datastore.js');
                    const rawStays: any[] = await db.stays.find({ $or: [{ garageId }, { garage_id: garageId }] });
                    const filteredStays = rawStays
                        .filter((s: any) => {
                            if (!search) return true;
                            const plate = String(s.plate || '').toLowerCase();
                            const ticket = String(s.ticket_code || '').toLowerCase();
                            return plate.includes(search) || ticket.includes(search);
                        })
                        .sort((a: any, b: any) => new Date(b.entryTime || 0).getTime() - new Date(a.entryTime || 0).getTime());
                    stays = filteredStays.slice(offset, offset + limit);

                    const rawMovs: any[] = await db.movements.find({ $or: [{ garageId }, { garage_id: garageId }] });
                    const allowedTypes = new Set(['CobroEstadia', 'CobroAbono', 'Upgrade']);
                    const filteredMovs = rawMovs
                        .filter((m: any) => {
                            if (!allowedTypes.has(m.type)) return false;
                            if (!search) return true;
                            const plate = String(m.plate || '').toLowerCase();
                            const ticket = String(m.ticket_code || '').toLowerCase();
                            return plate.includes(search) || ticket.includes(search);
                        })
                        .sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
                    movements = filteredMovs.slice(offset, offset + limit);

                    const stayIdsToFetch = new Set<string>();
                    movements.forEach((m: any) => {
                        const relId = m.relatedEntityId || m.related_entity_id;
                        if (m.type === 'CobroEstadia' && relId) stayIdsToFetch.add(relId);
                    });
                    stays.forEach((s: any) => {
                        stayIdsToFetch.delete(s.id);
                        stayIdsToFetch.delete(s._id);
                    });
                    if (stayIdsToFetch.size > 0) {
                        const ids = Array.from(stayIdsToFetch);
                        const extra = rawStays.filter((s: any) => ids.includes(s.id) || ids.includes(s._id));
                        extraStays.push(...extra);
                    }

                    const movIdsToFetch = new Set<string>();
                    stays.forEach((s: any) => {
                        if (s.is_prepaid && s.prepaid_movement_id) movIdsToFetch.add(s.prepaid_movement_id);
                    });
                    movements.forEach((m: any) => movIdsToFetch.delete(m.id));
                    if (movIdsToFetch.size > 0) {
                        const ids = Array.from(movIdsToFetch);
                        const extra = rawMovs.filter((m: any) => ids.includes(m.id));
                        extraMovs.push(...extra);
                    }
                }
                
                const allStaysToMap = [...stays, ...extraStays];
                const stayMap = new Map();
                allStaysToMap.forEach(s => {
                    stayMap.set(s.id || s._id, s);
                });
                
                const allMovsToMap = [...movements, ...extraMovs];
                const movMap = new Map();
                allMovsToMap.forEach(m => {
                    movMap.set(m.id, m);
                });
                
                // 5. Construct unified list
                const items: any[] = [];
                const seenIds = new Set<string>();
                
                for (const stay of stays) {
                    const stayId = stay.id || stay._id || '';
                    if (!stayId || seenIds.has(`entry-${stayId}`)) continue;
                    
                    items.push({
                        id: `entry-${stayId}`,
                        type: 'Entrada',
                        plate: stay.plate,
                        timestamp: stay.entryTime,
                        _stay: stay,
                        _movement: stay.is_prepaid && stay.prepaid_movement_id ? movMap.get(stay.prepaid_movement_id) : undefined
                    });
                    seenIds.add(`entry-${stayId}`);
                }
                
                for (const mov of movements) {
                    const movId = mov.id || '';
                    if (!movId) continue;
                    
                    if (mov.type === 'CobroEstadia') {
                        if (seenIds.has(`exit-${movId}`)) continue;
                        const relatedId = mov.relatedEntityId || mov.related_entity_id;
                        const relatedStay = relatedId ? stayMap.get(relatedId) : undefined;
                        
                        items.push({
                            id: `exit-${movId}`,
                            type: 'CobroEstadia',
                            plate: mov.plate,
                            timestamp: mov.timestamp,
                            amount: mov.amount,
                            paymentMethod: mov.paymentMethod || mov.payment_method,
                            operator: mov.operator,
                            notes: mov.notes,
                            _stay: relatedStay,
                            _movement: mov
                        });
                        seenIds.add(`exit-${movId}`);
                    } else if (mov.type === 'CobroAbono' || mov.type === 'Upgrade') {
                        if (seenIds.has(`abono-${movId}`)) continue;
                        items.push({
                            id: `abono-${movId}`,
                            type: mov.type,
                            plate: mov.plate,
                            timestamp: mov.timestamp,
                            amount: mov.amount,
                            paymentMethod: mov.paymentMethod || mov.payment_method,
                            operator: mov.operator,
                            notes: mov.notes,
                            _movement: mov
                        });
                        seenIds.add(`abono-${movId}`);
                    }
                }
                
                items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                
                const finalItems = items.slice(0, limit);
                res.json(finalItems);
                
            } catch (error: any) {
                OpsLogger.errorText('API', '[ERR] Error in /api/reimpresion/buscar', { error });
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
        app.post('/api/cocheras/:id/agregar-vehiculo', (req, res) => {
            if (garageController?.addVehicleAtomic) return garageController.addVehicleAtomic(req, res);
            res.status(404).send();
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
        app.get('/api/abonos/hydration', (req, res) => {
            if (garageController?.getHydration) return garageController.getHydration(req, res);
            res.status(404).send('Method not found');
        });
        
        app.get('/api/abonos', (req, res) => {
            if (garageController?.getSubscriptions) return garageController.getSubscriptions(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/abonos', (req, res) => {
            if (garageController?.createSubscription) return garageController.createSubscription(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/abonos/alta-completa', (req, res) => {
            if (garageController?.createSubscription) return garageController.createSubscription(req, res);
            res.status(404).send('Method not found');
        });
        app.post('/api/abonos/renovar/preview', (req, res) => {
            if (garageController?.previewMultiMonthDebt) return garageController.previewMultiMonthDebt(req, res);
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
        app.get('/api/deudas', (req, res) => {
            if (garageController?.getAllDebts) return garageController.getAllDebts(req, res);
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
                OpsLogger.debug('API', 'Payload de incidentes recibido', { incident });

                if (!incident || !incident.id) {
                    return res.status(400).json({ error: 'Payload inválido: falta id' });
                }

                // Sanitizar: eliminar campos null/undefined
                const cleanIncident: any = {};
                for (const [key, value] of Object.entries(incident)) {
                    if (value !== null && value !== undefined) {
                        cleanIncident[key] = value;
                    }
                }

                // Usar Repositorio
                const { IncidentRepository } = await import('../../modules/Garage/infra/IncidentRepository.js');
                const repo = new IncidentRepository();
                await repo.save(cleanIncident);
                
                OpsLogger.infoText('API', '[OK] Incidente guardado atómicamente');
                OpsLogger.infoText('API', '[OK] Incidente encolado');

                res.status(201).json({ success: true });
            } catch (error) {
                OpsLogger.errorText('API', '[ERR] Error en /api/incidents', { error });
                res.status(500).json({ error: 'Error interno al guardar incidente' });
            }
        });

        // Promos (Read-Only from Sync)
        app.get('/api/promos', async (req, res) => {
            try {
                const garageId = req.headers['x-garage-id'] as string;
                if (!garageId) return res.status(400).json({ error: 'x-garage-id header required' });

                let promos: any[] = [];
                if (StorageEngine.getEngine() === 'SQLITE') {
                    promos = require('../database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase()
                        .prepare("SELECT json_data FROM promos WHERE (json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?) AND (json_extract(json_data, '$.activo') = true OR json_extract(json_data, '$.active') = true)")
                        .all(garageId, garageId)
                        .map((r: any) => JSON.parse(r.json_data));
                } else {
                    const { db } = require('../database/datastore.js');
                    const raw: any[] = await db.promos.find({ $or: [{ garageId }, { garage_id: garageId }] });
                    promos = raw.filter((p: any) => p.activo === true || p.active === true);
                }
                res.json(promos);
            } catch (error) {
                OpsLogger.errorText('API', '[ERR] Error fetching promos', { error });
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

        // --- 2.5 Terminal Config & Offline Sync ---
        const readLocalGarage = async (garageId: string): Promise<any | null> => {
            if (!garageId) return null;
            try {
                const SQLiteManager = require('../database/sqlite/SQLiteManager.js').SQLiteManager;
                const dbSq = SQLiteManager.getInstance().getDatabase();
                const row = dbSq.prepare(`SELECT json_data FROM garages WHERE id = ? OR json_extract(json_data, '$.id') = ? LIMIT 1`).get(garageId, garageId) as any;
                if (row?.json_data) return JSON.parse(row.json_data);
            } catch {}
            try {
                const { db } = require('../database/datastore.js');
                const found = await db.garages.findOne({ $or: [{ id: garageId }, { _id: garageId }] });
                if (found) return found;
            } catch {}
            return null;
        };

        const persistLocalGarage = async (garageData: { garage_id: string; owner_id?: string; name?: string; address?: string }) => {
            if (!garageData?.garage_id) return;
            const doc = {
                id: garageData.garage_id,
                owner_id: garageData.owner_id || '',
                ownerId: garageData.owner_id || '',
                name: garageData.name || 'Garaje Local',
                address: garageData.address || '',
                updatedAt: new Date().toISOString()
            };
            try {
                const { db } = require('../database/datastore.js');
                await db.garages.update({ id: doc.id }, doc, { upsert: true });
            } catch {}
            try {
                const SQLiteManager = require('../database/sqlite/SQLiteManager.js').SQLiteManager;
                const dbSq = SQLiteManager.getInstance().getDatabase();
                dbSq.prepare(`
                    INSERT INTO garages (id, json_data)
                    VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        json_data = excluded.json_data
                `).run(doc.id, JSON.stringify(doc));
            } catch {}
        };

        app.get('/api/terminal/config', async (req, res) => {
            try {
                const { TerminalConfigManager } = require('../config/TerminalConfigManager.js');
                const configState = TerminalConfigManager.getConfigStatus();
                let config = configState.config;
                let source = configState.source;

                if (configState.status === 'CORRUPT') {
                    OpsLogger.errorText('CONFIG', '[ERR] Configuración local corrupta en terminal-config.json', { error: configState.error });
                }

                if (config && config.garage_id) {
                    try {
                        const realGarage = await readLocalGarage(config.garage_id);

                        if (realGarage) {
                            const expectedOwnerId = realGarage.owner_id || realGarage.ownerId || config.owner_id || '';
                            const expectedName = realGarage.name || config.name || 'Garaje Local';
                            const expectedAddress = realGarage.address ?? config.address ?? '';
                            if (
                                config.owner_id !== expectedOwnerId ||
                                config.name !== expectedName ||
                                config.address !== expectedAddress
                            ) {
                                OpsLogger.infoText('CONFIG', '[OK] Repaired metadata from local garage');
                                config = {
                                    garage_id: realGarage.id || realGarage._id || config.garage_id,
                                    owner_id: expectedOwnerId,
                                    name: expectedName,
                                    address: expectedAddress
                                };
                                TerminalConfigManager.setConfig(config);
                            }
                            await persistLocalGarage(config);
                        } else {
                            // Seed local DB immediately with existing terminal-config metadata so offline probes succeed
                            await persistLocalGarage(config);

                            // NEVER nullify a valid local configuration on remote error or offline state.
                            try {
                                const { supabase } = require('../lib/supabase.js');
                                const { data, error } = await supabase.from('garages').select('*').eq('id', config.garage_id).single();
                                if (!error && data) {
                                    config = {
                                        garage_id: data.id,
                                        owner_id: data.owner_id || config.owner_id || '',
                                        name: data.name || config.name || 'Garaje Local',
                                        address: data.address ?? config.address ?? ''
                                    };
                                    TerminalConfigManager.setConfig(config);
                                    await persistLocalGarage(config);
                                    source = 'REMOTE_REFRESHED' as any;
                                } else if (error) {
                                    OpsLogger.warnText('CONFIG', '[OFFLINE] Conservando configuración local de terminal (Supabase no disponible)', {
                                        garageId: config.garage_id,
                                        reason: error.message || String(error)
                                    });
                                }
                            } catch (remoteErr: any) {
                                OpsLogger.warnText('CONFIG', '[OFFLINE] Conservando configuración local de terminal ante error de red', {
                                    garageId: config.garage_id,
                                    reason: remoteErr?.message || String(remoteErr)
                                });
                            }
                        }
                    } catch (e) {
                        OpsLogger.errorText('CONFIG', '[ERR] Error resolving local garage metadata (preserving local config)', { error: e });
                    }
                }

                res.setHeader('x-terminal-config-status', config ? 'VALID' : configState.status);
                res.setHeader('x-terminal-config-source', config ? source : 'NONE');
                res.json(config || null);
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        app.post('/api/terminal/config', express.json(), async (req, res) => {
            try {
                const { TerminalConfigManager } = require('../config/TerminalConfigManager.js');
                const requestedGarageId = String(req.body.garage_id || req.body.garageId || '').trim();
                
                if (!requestedGarageId) {
                    return res.status(400).json({ error: 'garage_id is required' });
                }

                let realGarage: any = await readLocalGarage(requestedGarageId);
                const existingConfig = TerminalConfigManager.getConfig();

                if (!realGarage && existingConfig && existingConfig.garage_id === requestedGarageId) {
                    realGarage = {
                        id: existingConfig.garage_id,
                        owner_id: existingConfig.owner_id,
                        name: existingConfig.name,
                        address: existingConfig.address
                    };
                }

                let remoteError: any = null;
                if (!realGarage || !realGarage.name || !realGarage.owner_id) {
                    try {
                        const { supabase } = require('../lib/supabase.js');
                        const { data, error } = await supabase.from('garages').select('*').eq('id', requestedGarageId).single();
                        if (!error && data) {
                            realGarage = data;
                        } else if (error) {
                            remoteError = error;
                        }
                    } catch (e: any) {
                        remoteError = e;
                    }
                }

                // Fallback: if offline/remote failed, check if local operational data exists for this garageId (or recovery of corrupt config)
                if (!realGarage) {
                    const configState = TerminalConfigManager.getConfigStatus();
                    const hasClientRecoveryMeta = Boolean(req.body.name || req.body.owner_id || req.body.ownerId);
                    let hasOperationalEvidence = false;
                    try {
                        const { db } = require('../database/datastore.js');
                        const [vt, tf, pr, st, mv] = await Promise.all([
                            db.vehicleTypes.findOne({ $or: [{ garageId: requestedGarageId }, { garage_id: requestedGarageId }] }),
                            db.tariffs.findOne({ $or: [{ garageId: requestedGarageId }, { garage_id: requestedGarageId }] }),
                            db.prices.findOne({ $or: [{ garageId: requestedGarageId }, { garage_id: requestedGarageId }] }),
                            db.stays.findOne({ $or: [{ garageId: requestedGarageId }, { garage_id: requestedGarageId }] }),
                            db.movements.findOne({ $or: [{ garageId: requestedGarageId }, { garage_id: requestedGarageId }] })
                        ]);
                        hasOperationalEvidence = Boolean(vt || tf || pr || st || mv);
                    } catch {}

                    if (!hasOperationalEvidence) {
                        try {
                            const SQLiteManager = require('../database/sqlite/SQLiteManager.js').SQLiteManager;
                            const dbSq = SQLiteManager.getInstance().getDatabase();
                            const tables = ['vehicle_types', 'tariffs', 'prices', 'stays', 'movements'];
                            for (const tbl of tables) {
                                const row = dbSq.prepare(`SELECT 1 FROM ${tbl} WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ? LIMIT 1`).get(requestedGarageId, requestedGarageId);
                                if (row) {
                                    hasOperationalEvidence = true;
                                    break;
                                }
                            }
                        } catch {}
                    }

                    // Do NOT allow offline client metadata alone to overwrite a different existing valid terminal config
                    const isExistingDifferentGarage = Boolean(existingConfig?.garage_id && existingConfig.garage_id !== requestedGarageId);
                    const canRecoverOffline =
                        hasOperationalEvidence ||
                        (!isExistingDifferentGarage && configState.status === 'CORRUPT' && hasClientRecoveryMeta);

                    if (canRecoverOffline) {
                        realGarage = {
                            id: requestedGarageId,
                            owner_id: req.body.owner_id || req.body.ownerId || existingConfig?.owner_id || '',
                            name: req.body.name || existingConfig?.name || 'Garaje Recuperado Localmente',
                            address: req.body.address ?? existingConfig?.address ?? ''
                        };
                        OpsLogger.infoText('CONFIG', '[OFFLINE] Configuración de terminal recuperada desde evidencia local', { garageId: requestedGarageId });
                    }
                }

                if (!realGarage) {
                    const errMsg = String(remoteError?.message || remoteError?.details || '');
                    const isNetworkFailure =
                        errMsg.toLowerCase().includes('fetch') ||
                        errMsg.toLowerCase().includes('network') ||
                        errMsg.toLowerCase().includes('timeout') ||
                        errMsg.toLowerCase().includes('enotfound') ||
                        errMsg.toLowerCase().includes('econnrefused');

                    if (isNetworkFailure) {
                        return res.status(503).json({
                            error: 'Sin conexión a internet para verificar el garaje y no existen datos locales para este ID.',
                            code: 'OFFLINE_UNVERIFIED'
                        });
                    }
                    return res.status(404).json({ error: 'Garage not found or unreachable', code: 'GARAGE_NOT_FOUND' });
                }

                const finalConfig = {
                    garage_id: realGarage.id || realGarage._id || requestedGarageId,
                    owner_id: realGarage.owner_id || realGarage.ownerId || '',
                    name: realGarage.name || 'Garaje Local',
                    address: realGarage.address || ''
                };

                TerminalConfigManager.setConfig(finalConfig);
                await persistLocalGarage(finalConfig);
                OpsLogger.infoText('CONFIG', '[OK] Terminal configurada para garaje', { garageId: finalConfig.garage_id, name: finalConfig.name });
                res.json({ success: true, config: finalConfig });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        app.post('/api/terminal/clear-config', express.json(), async (req, res) => {
            try {
                const { TerminalConfigManager } = require('../config/TerminalConfigManager.js');
                const current = TerminalConfigManager.getConfig();
                TerminalConfigManager.clearConfig();
                OpsLogger.infoText('CONFIG', '[OK] Configuración de terminal revocada explícitamente (datos locales y cola preservados)', {
                    previousGarageId: current?.garage_id || null
                });
                res.json({ success: true, status: 'REVOKED' });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        app.get('/api/garages/:id', async (req, res) => {
            try {
                const garageId = req.params.id;
                const { TerminalConfigManager } = require('../config/TerminalConfigManager.js');

                // Check local DBs first
                const localGarage = await readLocalGarage(garageId);
                if (localGarage) {
                    return res.json(localGarage);
                }

                // Check TerminalConfigManager fallback
                const termCfg = TerminalConfigManager.getConfig();
                if (termCfg && termCfg.garage_id === garageId) {
                    return res.json({
                        id: termCfg.garage_id,
                        owner_id: termCfg.owner_id,
                        name: termCfg.name,
                        address: termCfg.address
                    });
                }

                // Fallback to Supabase if not found locally
                const { supabase } = require('../lib/supabase.js');
                const { data, error } = await supabase.from('garages').select('*').eq('id', garageId).single();
                if (error || !data) {
                    return res.status(404).json({ error: 'Garage not found or offline' });
                }
                await persistLocalGarage({
                    garage_id: data.id,
                    owner_id: data.owner_id,
                    name: data.name,
                    address: data.address
                });
                res.json(data);
            } catch (e: any) {
                res.status(500).json({ error: e.message });
            }
        });

        app.get('/api/sync/diagnostics', async (req, res) => {
            try {
                const SQLiteManager = require('../database/sqlite/SQLiteManager.js').SQLiteManager;
                const StorageEngine = require('../database/StorageEngine.js').StorageEngine;
                
                let outboxTotal = { c: 0 };
                let ackedCount = { c: 0 };
                let pending: any[] = [];
                let blocked: any[] = [];
                let schemaVersion = 0;
                let dbPath = 'Unknown';

                if (StorageEngine.getEngine() === 'SQLITE') {
                    try {
                        const dbSq = SQLiteManager.getInstance().getDatabase();
                        dbPath = SQLiteManager.getInstance().getDbPath();
                        schemaVersion = dbSq.prepare('PRAGMA user_version').get().user_version;
                        
                        outboxTotal = dbSq.prepare(`SELECT count(*) as c FROM outbox_events`).get() as any;
                        ackedCount = dbSq.prepare(`SELECT count(*) as c FROM outbox_events WHERE status = 'ACKED'`).get() as any;
                        pending = dbSq.prepare(`SELECT * FROM outbox_events WHERE status = 'PENDING' OR status = 'RETRY' ORDER BY sequence ASC`).all();
                        blocked = dbSq.prepare(`SELECT * FROM outbox_events WHERE status = 'BLOCKED' ORDER BY sequence ASC`).all();
                    } catch(e: any) {
                        OpsLogger.errorText('SYNC', '[ERR] Failed to query outbox_events', { error: e });
                        return res.status(500).json({ error: 'Failed to query diagnostics', details: e.message });
                    }
                } else {
                    try {
                        const { db, DATA_DIR } = require('../database/datastore.js');
                        dbPath = `${DATA_DIR} (NeDB)`;
                        const allMutations: any[] = await db.mutations.find({});
                        outboxTotal = { c: allMutations.length };
                        ackedCount = { c: allMutations.filter((m: any) => m.status === 'ACKED' || m.synced === true).length };
                        pending = allMutations
                            .filter((m: any) => m.status === 'PENDING' || m.status === 'RETRY' || (!m.status && !m.synced))
                            .map((m: any) => ({
                                entity_type: m.entityType,
                                operation: m.operation,
                                entity_id: m.entityId,
                                status: m.status || 'PENDING',
                                attempts: m.retryCount || 0,
                                created_at: m.timestamp,
                                last_attempt_at: m.lastAttemptAt,
                                last_error: m.lastError
                            }));
                        blocked = allMutations
                            .filter((m: any) => m.status === 'BLOCKED')
                            .map((m: any) => ({
                                entity_type: m.entityType,
                                operation: m.operation,
                                entity_id: m.entityId,
                                status: 'BLOCKED',
                                attempts: m.retryCount || 0,
                                created_at: m.timestamp,
                                last_attempt_at: m.lastAttemptAt,
                                last_error: m.lastError
                            }));
                    } catch {
                        dbPath = 'Legacy NeDB';
                    }
                }
                
                const mapEvt = (r: any) => ({
                     entityType: r.entity_type,
                     operation: r.operation,
                     entityId: r.entity_id,
                     status: r.status,
                     attempts: r.attempts,
                     createdAt: r.created_at,
                     lastAttemptAt: r.last_attempt_at,
                     lastError: r.last_error || r.last_error_code
                });
                
                res.json({
                    database: {
                        storageEngine: StorageEngine.getEngine(),
                        dbPath: dbPath,
                        schemaVersion: schemaVersion,
                        outboxTotal: outboxTotal.c,
                        ackedCount: ackedCount.c
                    },
                    pending: pending.map(mapEvt),
                    blocked: blocked.map(mapEvt)
                });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        // Sync Bootstrap Endpoint
        app.post('/api/sync/bootstrap', async (req, res) => {
            const { garageId } = req.body;
            if (!garageId) return res.status(400).json({ error: 'garageId required' });

            OpsLogger.infoText('SYNC', `Initial Bootstrap Sync Triggered`, { garageId });
            if (syncService?.runSyncCycle) {
                try {
                    const result = await syncService.runSyncCycle(garageId, 'MANUAL_BOOTSTRAP');
                    syncService.initRealtime(garageId);
                    if (syncService.startReconciliation) {
                        syncService.startReconciliation(garageId);
                    }

                    const readiness = await probeLocalDataUnified(() => SQLiteManager.getInstance().getDatabase(), garageId);
                    const failedTables = result?.failedTables || [];

                    if (result?.status === 'FAILED') {
                        return res.status(503).json({
                            status: 'OFFLINE',
                            error: 'Sin conexión remota para completar la sincronización inicial',
                            failedTables,
                            readiness
                        });
                    }

                    if (result?.status === 'WITH_WARNINGS' || failedTables.length > 0 || !readiness.hasLocalData) {
                        return res.status(502).json({
                            status: 'PARTIAL_FAILURE',
                            error: failedTables.length > 0
                                ? `Sincronización incompleta: fallaron tablas (${failedTables.join(', ')})`
                                : `Datos operativos requeridos incompletos (${readiness.missing?.join(', ') || 'configuración faltante'})`,
                            failedTables,
                            warnings: failedTables,
                            readiness
                        });
                    }

                    res.json({
                        status: 'READY',
                        message: 'Sync completed successfully',
                        failedTables: [],
                        readiness
                    });
                } catch (err: any) {
                    OpsLogger.errorText('SYNC', '[ERR] Bootstrap Sync Error', { error: err });
                    const readiness = await probeLocalDataUnified(() => SQLiteManager.getInstance().getDatabase(), garageId).catch(() => null);
                    res.status(500).json({ error: 'Bootstrap sync failed', details: err.message, readiness });
                }
            } else {
                res.status(500).json({ error: 'Sync service not available' });
            }
        });

        // Background Sync Endpoint (Silent - flushes pending outbox and pulls latest changes)
        app.post('/api/sync/background', async (req, res) => {
            const { TerminalConfigManager } = require('../config/TerminalConfigManager.js');
            const garageId = req.body?.garageId || (req.headers['x-garage-id'] as string) || TerminalConfigManager.getConfig()?.garage_id;
            if (!garageId) return res.status(400).json({ error: 'garageId required' });

            OpsLogger.debug('SYNC', `Background Sync Triggered`, { garageId });
            try {
                if (syncService?.runSyncCycle) {
                    await syncService.runSyncCycle(garageId, 'BACKGROUND_RECONNECT');
                } else if (syncService?.pullAllData) {
                    if (syncService.processQueue) await syncService.processQueue();
                    await syncService.pullAllData(garageId, true);
                }
            } catch (err) {
                OpsLogger.errorText('SYNC', '[ERR] Background Sync Error', { error: err });
                return res.status(500).json({ error: 'Background sync failed' });
            }

            res.json({ message: 'Background sync finished' });
        });

        // Local-only readiness probe used by AuthContext.triggerInitialSync (no Supabase, works offline)
        app.get('/api/sync/has-local-data/:garageId', createUnifiedHasLocalDataHandler(() => SQLiteManager.getInstance().getDatabase()));

        // Check Sync Status Endpoint
        app.get('/api/sync/check', async (req, res) => {
            if (syncService) {
                const status = await syncService.getStatus();
                // If there are blocked events, we want to fetch them if requested
                if (req.query.include_blocked === 'true' && status.blocked > 0) {
                    try {
                        if (StorageEngine.getEngine() === 'SQLITE') {
                            const SQLiteManager = require('../database/sqlite/SQLiteManager').SQLiteManager;
                            const dbSq = SQLiteManager.getInstance().getDatabase();
                            const blockedEvents = dbSq.prepare(`SELECT sequence, entity_type, entity_id, operation, status, created_at, updated_at, last_error, last_error_code, payload FROM outbox_events WHERE status = 'BLOCKED'`).all();
                            status.blockedEvents = blockedEvents;
                        } else {
                            const { db } = require('../database/datastore.js');
                            status.blockedEvents = await db.mutations.find({ status: 'BLOCKED' });
                        }
                    } catch (e) {
                        OpsLogger.errorText('SYNC', '[ERR] Error fetching blocked events', { error: e });
                    }
                }
                res.json(status);
            } else {
                res.json({ state: 'OFFLINE', isSyncing: false, pending: 0, blocked: 0 });
            }
        });

        // Requeue blocked events (selective)
        app.post('/api/sync/retry-blocked', async (req, res) => {
            try {
                const { sequences } = req.body;
                if (!sequences || !Array.isArray(sequences)) return res.status(400).json({ error: 'sequences array required' });
                
                const StorageEngine = require('../database/StorageEngine').StorageEngine;
                if (StorageEngine.getEngine() === 'SQLITE') {
                    const SQLiteManager = require('../database/sqlite/SQLiteManager').SQLiteManager;
                    const dbSq = SQLiteManager.getInstance().getDatabase();
                    
                    const placeholders = sequences.map(() => '?').join(',');
                    if (placeholders.length > 0) {
                        dbSq.prepare(`UPDATE outbox_events SET status = 'RETRY' WHERE status = 'BLOCKED' AND sequence IN (${placeholders})`).run(...sequences);
                    }
                    res.json({ success: true, message: 'Blocked events requeued' });
                } else {
                    const { db } = require('../database/datastore.js');
                    await db.mutations.update({ status: 'BLOCKED', _id: { $in: sequences } }, { $set: { status: 'RETRY', retryCount: 0 } }, { multi: true });
                    res.json({ success: true, message: 'Blocked events requeued' });
                }
            } catch (err: any) {
                res.status(500).json({ success: false, message: err.message });
            }
        });

        // ── Hardware Integration Routes ──────────────────────────
        const readHardwareCollection = async (tableName: 'stays' | 'vehicles'): Promise<any[]> => {
            if (StorageEngine.getEngine() === 'SQLITE') {
                const dbSq = require('../database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase();
                return dbSq.prepare(`SELECT json_data FROM ${tableName}`).all().map((r: any) => JSON.parse(r.json_data));
            }
            const { db } = require('../database/datastore.js');
            return await db[tableName].find({});
        };

        // Check exit authorization (used by barrier driver / simulator)
        app.get('/api/hardware/check-exit/:ticketCode', async (req, res) => {
            try {
                const normalizedCode = req.params.ticketCode.trim().toUpperCase();

                // Search ALL stays with this ticket_code (not just active ones!)
                // After payment: active=false, exit_authorized=true
                const allStays: any[] = await readHardwareCollection('stays');
                const candidates = allStays.filter((s: any) =>
                    s.ticket_code && String(s.ticket_code).toUpperCase() === normalizedCode
                );

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
                OpsLogger.errorText('HARDWARE', '[ERR] check-exit error', { error });
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
                const allVehicles = await readHardwareCollection('vehicles');
                const vehicles: any[] = allVehicles.filter((v: any) => String(v.rfid_tag || '').toUpperCase() === rfidCode);

                if (vehicles.length === 0) {
                    // No vehicle registered with this RFID tag
                    return res.json({ authorized: false, reason: 'NOT_FOUND', rfidCode });
                }

                const vehicle = vehicles[0];
                const plate = vehicle.plate;
                const allStaysForGarage = await readHardwareCollection('stays');

                // ── Step 2: Subscribers auto-authorize ──
                // Subscribers may or may not have an active stay, but their tag always works
                if (vehicle.is_subscriber === true) {
                    // Check for anti-passback: find any stay with barrier_exit_used
                    const subscriberStays: any[] = allStaysForGarage.filter((s: any) => s.plate === plate && s.active === true);

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
                const allStays: any[] = allStaysForGarage.filter((s: any) => s.plate === plate);

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
                OpsLogger.errorText('HARDWARE', '[ERR] check-rfid error', { error });
                res.status(500).json({ authorized: false, reason: 'ERROR', rfidCode: req.params.rfidCode, error: error.message });
            }
        });

        // Mark stay as exit-used for anti-passback
        app.patch('/api/hardware/mark-exit-used/:stayId', async (req, res) => {
            try {
                const stayId = req.params.stayId;
                const { barrier_exit_used, barrier_exit_at } = req.body;

                const { StayRepository } = await import('../../modules/AccessControl/infra/StayRepository.js');
                const stayRepo = new StayRepository();
                const stay = await stayRepo.findById(stayId);

                if (stay) {
                    stay.barrier_exit_used = barrier_exit_used;
                    stay.barrier_exit_at = barrier_exit_at ? new Date(barrier_exit_at) : new Date();
                    await stayRepo.save(stay);
                }

                res.json({ success: true, stayId });
            } catch (error: any) {
                OpsLogger.errorText('HARDWARE', '[ERR] mark-exit-used error', { error });
                res.status(500).json({ error: error.message });
            }
        });

        // Get pending hardware entries
        app.get('/api/hardware/pending-entries', async (req, res) => {
            try {
                const garageId = (req.headers['x-garage-id'] as string);
                const allStays = await readHardwareCollection('stays');
                const pending = allStays.filter((s: any) =>
                    s.is_pending_processing === true &&
                    (!garageId || s.garageId === garageId || s.garage_id === garageId)
                );
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
            OpsLogger.debug('STARTUP', `Sirviendo Frontend desde: ${frontendDist}`);
            app.use(express.static(frontendDist));
            app.use((req, res, next) => {
                if (req.path.startsWith('/api')) return next();
                res.sendFile(path.join(frontendDist, 'index.html'));
            });
        }

        // --- Readiness Endpoint ---
        app.get('/api/readiness', (req, res) => {
            res.status(200).json({
                ok: true,
                service: 'garageia-local',
                timestamp: new Date().toISOString()
            });
        });

        app.get('/api/health', (req, res) => {
            const StorageEngine = require('../database/StorageEngine.js').StorageEngine;
            const SQLiteManager = require('../database/sqlite/SQLiteManager.js').SQLiteManager;
            
            let schemaVersion = 0;
            try {
                if (StorageEngine.getEngine() === 'SQLITE') {
                    const db = SQLiteManager.getInstance().getDatabase();
                    schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
                }
            } catch (e) {
                // Ignore if db is not ready yet
            }

            res.json({
                status: 'ready',
                storageEngine: StorageEngine.getEngine(),
                schemaVersion: schemaVersion
            });
        });

        // --- Start Server ---
        const PORT = port || process.env.PORT || 3000;

        httpServer.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                OpsLogger.errorText('STARTUP', `[ERR] El puerto ${PORT} ya está en uso (EADDRINUSE)`);
                process.exit(1);
            }
            OpsLogger.errorText('STARTUP', '[ERR] HTTP Server error', { error: err });
        });

        httpServer.listen(PORT, async () => {
            OpsLogger.infoText('STARTUP', `Backend listening · :${PORT}`);
            OpsLogger.debug('STARTUP', `GarageIA escuchando en http://localhost:${PORT}`);
            OpsLogger.infoText('STARTUP', `[OK] Base de Datos Local: LISTA`);
        });
    } catch (err) {
        OpsLogger.errorText('STARTUP', '[ERR] Error fatal en startServer', { error: err });
    }
};

startServer().catch(err => OpsLogger.errorText('STARTUP', '[ERR] Error en la promesa de arranque', { error: err }));
