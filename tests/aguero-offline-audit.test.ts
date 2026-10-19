import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import Datastore from 'nedb-promises';
import { TerminalConfigManager } from '../src/infrastructure/config/TerminalConfigManager.js';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine.js';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager.js';
import { db, DATA_DIR } from '../src/infrastructure/database/datastore.js';
import { NeDBConfigRepository } from '../src/modules/Configuration/infra/ConfigRepository.js';
import { ConfigRepository as SqliteConfigRepository } from '../src/modules/Configuration/infra/SqliteConfigRepository.js';
import { AuthController } from '../src/modules/Identity/infra/AuthController.js';
import { PricingEngine } from '../src/modules/Billing/domain/PricingEngine.js';
import { probeLocalDataUnified } from '../src/modules/Sync/application/LocalDataProbe.js';
import { NeDBSyncService } from '../src/modules/Sync/application/SyncService.js';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator.js';
import { QueueService } from '../src/modules/Sync/application/QueueService.js';
import { StayRepository } from '../src/modules/AccessControl/infra/StayRepository.js';
import { MovementRepository } from '../src/modules/Billing/infra/MovementRepository.js';
import { ShiftCloseRepository } from '../src/modules/Garage/infra/ShiftCloseRepository.js';
import { supabase } from '../src/infrastructure/lib/supabase.js';

const AGUERO_GARAGE_ID = 'ebf7eaa0-339e-455f-bcde-dd51636e1f21';
const AGUERO_OWNER_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_GARAGE_ID = '99999999-8888-4777-8666-555555555555';
const OTHER_OWNER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('Auditoría Crítica Offline-First — Incidente Terminal Agüero (GarageIA 3.4.8)', () => {
    const testConfigDir = path.join(DATA_DIR, 'test');
    const configFilePath = path.join(testConfigDir, 'terminal-config.json');
    const backupFilePath = `${configFilePath}.bak`;

    beforeEach(() => {
        if (!fs.existsSync(testConfigDir)) {
            fs.mkdirSync(testConfigDir, { recursive: true });
        }
        if (fs.existsSync(configFilePath)) fs.unlinkSync(configFilePath);
        if (fs.existsSync(backupFilePath)) fs.unlinkSync(backupFilePath);

        // Fresh in-memory NeDB datastores (nedb-promises) for isolated testing
        db.garages = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.employees = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.vehicleTypes = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.tariffs = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.prices = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.stays = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.movements = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.shiftCloses = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.mutations = Datastore.create({ inMemoryOnly: true, timestampData: true });
        (db as any).configs = Datastore.create({ inMemoryOnly: true, timestampData: true });

        SQLiteManager.initForTest();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (fs.existsSync(configFilePath)) fs.unlinkSync(configFilePath);
        if (fs.existsSync(backupFilePath)) fs.unlinkSync(backupFilePath);
    });

    it('Escenarios 3, 4, 7 y 13: Conserva configuración ante reinicios/cortes, recupera desde .bak si hay corrupción por apagado brusco, distingue terminal sin configurar y soporta desvinculación limpia', () => {
        // 7. Terminal genuinamente sin configurar
        const unconfiguredState = TerminalConfigManager.getConfigStatus();
        expect(unconfiguredState.status).toBe('UNCONFIGURED');
        expect(unconfiguredState.config).toBeNull();

        // 3. Configurar terminal Agüero y simular reinicio sin internet
        const agueroConfig = {
            garage_id: AGUERO_GARAGE_ID,
            owner_id: AGUERO_OWNER_ID,
            name: 'Garaje Agüero',
            address: 'Agüero 1234, CABA'
        };
        TerminalConfigManager.setConfig(agueroConfig);

        const validState = TerminalConfigManager.getConfigStatus();
        expect(validState.status).toBe('VALID');
        expect(validState.source).toBe('PRIMARY');
        expect(validState.config?.garage_id).toBe(AGUERO_GARAGE_ID);
        expect(fs.existsSync(backupFilePath)).toBe(true);

        // 4. Simular corte de energía / reinicio de Windows que trunca terminal-config.json pero preserva .bak
        fs.writeFileSync(configFilePath, '{ "garage_id": "ebf7eaa0-corrupt', 'utf-8');
        const recoveredState = TerminalConfigManager.getConfigStatus();
        expect(recoveredState.status).toBe('VALID');
        expect(recoveredState.source).toBe('BACKUP');
        expect(recoveredState.config?.garage_id).toBe(AGUERO_GARAGE_ID);
        // Verifica que el archivo primario fue auto-reparado
        expect(JSON.parse(fs.readFileSync(configFilePath, 'utf-8')).garage_id).toBe(AGUERO_GARAGE_ID);

        // 13. Desvinculación explícita limpia tanto primario como backup
        TerminalConfigManager.clearConfig();
        expect(TerminalConfigManager.getConfigStatus().status).toBe('UNCONFIGURED');
        expect(fs.existsSync(configFilePath)).toBe(false);
        expect(fs.existsSync(backupFilePath)).toBe(false);
    });

    it('Escenarios 1 y 5 (Causa Raíz Agüero): En motor NEDB con Supabase caído (TypeError: fetch failed), ConfigRepository recupera precios con priceList y PricingEngine calcula sin Matrix Received (Keys): []', async () => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('NEDB');

        // Sembrar datos tal como los guarda NeDBSyncService en producción (con priceList: 'standard' | 'electronic')
        await db.vehicleTypes.insert([
            { id: 'vt-auto', garageId: AGUERO_GARAGE_ID, name: 'Auto' },
            { id: 'vt-camioneta', garageId: AGUERO_GARAGE_ID, name: 'Camioneta' }
        ]);

        await db.tariffs.insert([
            { id: 't-hora', garageId: AGUERO_GARAGE_ID, name: 'Hora', type: 'hora', hours: 1, days: 0, minutes: 0, priority: 1 },
            { id: 't-estadia', garageId: AGUERO_GARAGE_ID, name: 'Estadía 24hs', type: 'turno', hours: 0, days: 1, minutes: 0, priority: 2 }
        ]);

        await db.prices.insert([
            { id: 'p-1', garageId: AGUERO_GARAGE_ID, vehicleTypeId: 'vt-auto', tariffId: 't-hora', amount: 3500, priceList: 'standard' },
            { id: 'p-2', garageId: AGUERO_GARAGE_ID, vehicleTypeId: 'vt-auto', tariffId: 't-estadia', amount: 18000, priceList: 'standard' },
            { id: 'p-3', garageId: AGUERO_GARAGE_ID, vehicleTypeId: 'vt-camioneta', tariffId: 't-hora', amount: 4500, priceList: 'standard' },
            { id: 'p-4', garageId: AGUERO_GARAGE_ID, vehicleTypeId: 'vt-auto', tariffId: 't-hora', amount: 3850, priceList: 'electronic' }
        ]);

        // Simular corte total de internet (TypeError: fetch failed en Supabase)
        vi.spyOn(supabase, 'from').mockImplementation(() => {
            throw new TypeError('fetch failed');
        });

        const repo = new NeDBConfigRepository();
        const standardPrices = await repo.getPrices(AGUERO_GARAGE_ID, 'standard');
        const electronicPrices = await repo.getPrices(AGUERO_GARAGE_ID, 'electronic');
        const vehicleTypes = await repo.getVehicleTypes(AGUERO_GARAGE_ID);
        const tariffs = await repo.getTariffs(AGUERO_GARAGE_ID);

        expect(standardPrices.length).toBe(3);
        expect(electronicPrices.length).toBe(1);
        expect(vehicleTypes.length).toBe(2);
        expect(tariffs.length).toBe(2);

        // Construir matriz igual que BillingController
        const vtMap = new Map<string, string>();
        vehicleTypes.forEach((vt: any) => vtMap.set(vt.id, vt.name.toLowerCase()));
        const tMap = new Map<string, string>();
        tariffs.forEach((t: any) => tMap.set(t.id, t.name.toLowerCase()));

        const matrix: Record<string, Record<string, number>> = {};
        standardPrices.forEach((p: any) => {
            const vName = vtMap.get(p.vehicleTypeId);
            const tName = tMap.get(p.tariffId);
            if (vName && tName) {
                if (!matrix[vName]) matrix[vName] = {};
                matrix[vName][tName] = Number(p.amount);
            }
        });

        expect(Object.keys(matrix)).toContain('auto');
        expect(Object.keys(matrix)).toContain('camioneta');

        // PricingEngine debe cotizar 1 hora de Auto sin arrojar "No tariff configuration found"
        const engine = new PricingEngine(
            { getAll: async () => tariffs },
            { getParams: async () => ({ gracePeriodMinutes: 10, fractionateAfter: 0, initialTolerance: 5 }) },
            { getPrices: async () => matrix }
        );
        const entry = new Date('2026-10-16T15:00:00.000Z');
        const exit = new Date('2026-10-16T15:50:00.000Z');
        const quote = await engine.calculateParkingFee(
            { entryTime: entry, plate: 'AGU123', vehicleType: 'Auto' },
            exit,
            'Efectivo'
        );

        expect(quote.price).toBe(3500);
    });

    it('Escenarios 2, 8, 9 y 10: Login Offline-First en modo NEDB (Owner y Operador autorizados, rechazo de clave inválida, rechazo de usuario sin evidencia local y aislamiento de otro garaje)', async () => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('NEDB');

        TerminalConfigManager.setConfig({
            garage_id: AGUERO_GARAGE_ID,
            owner_id: AGUERO_OWNER_ID,
            name: 'Garaje Agüero',
            address: 'Agüero 1234'
        });

        // 1. Simular login online previo del Owner por email (para cachear su password_verifier scrypt en NeDB)
        vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
            if (table === 'profiles') {
                return {
                    select: () => ({
                        eq: () => ({
                            limit: async () => ({
                                data: [{
                                    id: AGUERO_OWNER_ID,
                                    email: 'owner@aguero.com',
                                    username: 'owner@aguero.com',
                                    full_name: 'Dueño Agüero',
                                    role: 'OWNER'
                                }],
                                error: null
                            })
                        })
                    })
                } as any;
            }
            if (table === 'garages') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: { id: AGUERO_GARAGE_ID, owner_id: AGUERO_OWNER_ID },
                                error: null
                            })
                        })
                    })
                } as any;
            }
            return { select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) } as any;
        });

        const authController = new AuthController();
        const mockRes = () => {
            const res: any = {};
            res.status = vi.fn().mockReturnValue(res);
            res.json = vi.fn().mockReturnValue(res);
            return res;
        };

        // Login online exitoso -> guarda verifier seguro scrypt en NeDB y SQLite
        const resOnline = mockRes();
        await authController.login({
            body: { username: 'owner@aguero.com', password: 'SecretOwnerPassword!', garage_id: AGUERO_GARAGE_ID },
            headers: {}
        } as any, resOnline);
        expect(resOnline.status).toHaveBeenCalledWith(200);

        // Sembrar además un empleado local en NeDB para Agüero y otro de otro garaje
        await db.employees.insert([
            {
                id: 'emp-aguero-1',
                username: 'operador.aguero',
                password_hash: 'OperadorPass123',
                first_name: 'Carlos',
                last_name: 'Gomez',
                role: 'OPERATOR',
                garage_id: AGUERO_GARAGE_ID,
                owner_id: AGUERO_OWNER_ID,
                permissions: { billing: true }
            },
            {
                id: 'emp-otro-1',
                username: 'operador.otro',
                password_hash: 'OtroPass123',
                first_name: 'Pedro',
                last_name: 'Otro',
                role: 'OPERATOR',
                garage_id: OTHER_GARAGE_ID,
                owner_id: OTHER_OWNER_ID,
                permissions: {}
            }
        ]);

        // 2. CORTAR INTERNET: Supabase lanza fetch failed
        vi.spyOn(supabase, 'from').mockImplementation(() => {
            throw new TypeError('fetch failed');
        });

        // Escenario 8a: Owner inicia sesión OFFLINE usando el verifier scrypt cacheado (y sin texto plano en DB)
        const storedOwner: any = await db.employees.findOne({ id: AGUERO_OWNER_ID });
        expect(storedOwner).toBeTruthy();
        expect(storedOwner.password_verifier).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
        expect(storedOwner.password).toBeUndefined();
        expect(storedOwner.password_hash).toBeUndefined();

        // Verificar que también fue cacheado correctamente en SQLite (tabla employees con columnas id, json_data)
        const sqRow = SQLiteManager.getInstance().getDatabase().prepare(`SELECT json_data FROM employees WHERE id = ?`).get(AGUERO_OWNER_ID) as any;
        expect(sqRow?.json_data).toBeTruthy();

        const resOfflineOwner = mockRes();
        await authController.login({
            body: { username: 'owner@aguero.com', password: 'SecretOwnerPassword!', garage_id: AGUERO_GARAGE_ID },
            headers: {}
        } as any, resOfflineOwner);
        expect(resOfflineOwner.status).toHaveBeenCalledWith(200);
        expect(resOfflineOwner.json).toHaveBeenCalledWith(expect.objectContaining({
            id: AGUERO_OWNER_ID,
            role: 'OWNER'
        }));

        // Escenario 8b: Operador de Agüero inicia sesión OFFLINE en modo NEDB
        const resOfflineEmp = mockRes();
        await authController.login({
            body: { username: 'operador.aguero', password: 'OperadorPass123', garage_id: AGUERO_GARAGE_ID },
            headers: {}
        } as any, resOfflineEmp);
        expect(resOfflineEmp.status).toHaveBeenCalledWith(200);
        expect(resOfflineEmp.json).toHaveBeenCalledWith(expect.objectContaining({
            id: 'emp-aguero-1',
            username: 'operador.aguero'
        }));

        // Escenario 9: Contraseña inválida sin internet -> 401 INVALID_CREDENTIALS
        const resBadPass = mockRes();
        await authController.login({
            body: { username: 'owner@aguero.com', password: 'WrongPassword', garage_id: AGUERO_GARAGE_ID },
            headers: {}
        } as any, resBadPass);
        expect(resBadPass.status).toHaveBeenCalledWith(401);
        expect(resBadPass.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'INVALID_CREDENTIALS'
        }));

        // Escenario 10: Usuario de otro garaje sin internet -> 403 UNAUTHORIZED_GARAGE
        const resOtherGarage = mockRes();
        await authController.login({
            body: { username: 'operador.otro', password: 'OtroPass123', garage_id: AGUERO_GARAGE_ID },
            headers: {}
        } as any, resOtherGarage);
        expect(resOtherGarage.status).toHaveBeenCalledWith(403);
        expect(resOtherGarage.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'UNAUTHORIZED_GARAGE'
        }));

        // Usuario inexistente localmente durante corte -> 401 con código OFFLINE_NO_LOCAL_USER (diferenciado de clave errónea)
        const resUnknownOffline = mockRes();
        await authController.login({
            body: { username: 'nuevo.jamasingreso', password: 'AnyPassword', garage_id: AGUERO_GARAGE_ID },
            headers: {}
        } as any, resUnknownOffline);
        expect(resUnknownOffline.status).toHaveBeenCalledWith(401);
        expect(resUnknownOffline.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'OFFLINE_NO_LOCAL_USER'
        }));
    });

    it('Escenario 6: Sonda unificada has-local-data detecta datos locales en el motor activo (NEDB + TerminalConfigManager) y evita falsos positivos si SQLITE está vacío', async () => {
        TerminalConfigManager.setConfig({
            garage_id: AGUERO_GARAGE_ID,
            owner_id: AGUERO_OWNER_ID,
            name: 'Garaje Agüero',
            address: 'Agüero 1234'
        });

        await db.vehicleTypes.insert({ id: 'vt-1', garageId: AGUERO_GARAGE_ID, name: 'Auto' } as any);
        await db.tariffs.insert({ id: 't-1', garageId: AGUERO_GARAGE_ID, name: 'Hora', hours: 1 } as any);
        await db.prices.insert({ id: 'p-1', garageId: AGUERO_GARAGE_ID, vehicleTypeId: 'vt-1', tariffId: 't-1', amount: 3500, priceList: 'standard' } as any);

        const sqDb = SQLiteManager.getInstance().getDatabase();

        // Si el motor activo es SQLITE pero los datos sólo están en NeDB, NO debe declarar hasLocalData=true
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        const sqliteEmptyProbe = await probeLocalDataUnified(() => sqDb, AGUERO_GARAGE_ID);
        expect(sqliteEmptyProbe.hasLocalData).toBe(false);

        // Cuando el motor activo es NEDB (como en Agüero 3.4.8), detecta los datos locales de NeDB + TerminalConfigManager
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('NEDB');
        const probeResult = await probeLocalDataUnified(() => sqDb, AGUERO_GARAGE_ID);
        expect(probeResult.hasLocalData).toBe(true);
        expect(probeResult.checks.garageRow).toBe(true);
        expect(probeResult.checks.vehicleTypes).toBe(true);
        expect(probeResult.checks.tariffs).toBe(true);
        expect(probeResult.checks.prices).toBe(true);
    });

    it('Escenarios 11 y 12: Cola de sincronización offline y reconciliación al volver internet sin duplicar registros ni perder tablas fallidas', async () => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('NEDB');

        const queueService = new QueueService();
        const syncService = new NeDBSyncService();

        // 11. Encolar movimiento cobrado offline
        const movementId = 'mov-offline-aguero-001';
        await queueService.enqueue('Movement', 'CREATE', {
            id: movementId,
            garageId: AGUERO_GARAGE_ID,
            amount: 3500,
            paymentMethod: 'Efectivo',
            timestamp: new Date().toISOString()
        });

        const statusOffline = await syncService.getStatus();
        expect(statusOffline.pending).toBe(1);

        // Simular fallo de red durante primer intento de processQueue
        vi.spyOn(supabase, 'from').mockImplementation(() => {
            throw new TypeError('fetch failed');
        });

        await syncService.processQueue();
        const statusAfterFailedAttempt = await syncService.getStatus();
        expect(statusAfterFailedAttempt.pending).toBe(1);
        expect(statusAfterFailedAttempt.state).toBe('BACKEND_UNREACHABLE');

        // Resetear nextAttemptAt para simular que el backoff expiró y vuelve internet
        await db.mutations.update({}, { $set: { nextAttemptAt: new Date(Date.now() - 1000).toISOString() } }, { multi: true });

        // 12. Vuelve internet: Supabase responde OK con upsert idempotente
        const upsertedPayloads: any[] = [];
        vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
            return {
                upsert: async (payload: any) => {
                    upsertedPayloads.push({ table, payload });
                    return { data: [payload], error: null };
                },
                select: () => ({
                    eq: () => ({
                        gt: async () => ({ data: [], error: null }),
                        then: (cb: any) => Promise.resolve({ data: [], error: null }).then(cb)
                    })
                })
            } as any;
        });

        await syncService.processQueue();
        const statusAfterReconnect = await syncService.getStatus();
        expect(statusAfterReconnect.pending).toBe(0);
        expect(statusAfterReconnect.state).toBe('ONLINE');
        expect(upsertedPayloads.length).toBe(1);
        expect(upsertedPayloads[0].payload.id).toBe(movementId);
    });

    it('Grupo A & B (Seguridad y Conectividad): Rechaza adulteración de garage_id en localStorage, impide bypass con clave local obsoleta cuando hay conexión, y soporta errores DNS/Timeout/HTTP 500/503', async () => {
        TerminalConfigManager.setConfig({
            garage_id: AGUERO_GARAGE_ID,
            owner_id: AGUERO_OWNER_ID,
            name: 'Garaje Agüero',
            address: 'Agüero 1234'
        });

        await db.garages.insert({
            id: AGUERO_GARAGE_ID,
            owner_id: AGUERO_OWNER_ID,
            ownerId: AGUERO_OWNER_ID,
            name: 'Garaje Agüero'
        } as any);

        // Sembrar empleado local con contraseña vieja ("ClaveVieja123")
        await db.employees.insert({
            id: 'emp-1',
            username: 'cajero.aguero',
            password_hash: 'ClaveVieja123',
            passwordHash: 'ClaveVieja123',
            owner_id: AGUERO_OWNER_ID,
            ownerId: AGUERO_OWNER_ID,
            garage_id: AGUERO_GARAGE_ID,
            role: 'OPERATOR'
        } as any);

        const authController = new AuthController();
        const mockRes = () => {
            const res: any = {};
            res.status = vi.fn().mockReturnValue(res);
            res.json = vi.fn().mockReturnValue(res);
            return res;
        };

        // 1. Intento de login con garage_id adulterado desde localStorage distinto al de TerminalConfigManager -> 403 TERMINAL_GARAGE_MISMATCH
        const resTampered = mockRes();
        await authController.login({
            body: { username: 'cajero.aguero', password: 'ClaveVieja123', garage_id: OTHER_GARAGE_ID },
            headers: {}
        } as any, resTampered);
        expect(resTampered.status).toHaveBeenCalledWith(403);
        expect(resTampered.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'TERMINAL_GARAGE_MISMATCH'
        }));

        // 2. Cuando Supabase está ONLINE y la contraseña en la nube cambió a "ClaveNueva999", usar "ClaveVieja123" NO debe hacer fallback al caché local -> 401 INVALID_CREDENTIALS
        vi.spyOn(supabase, 'from').mockImplementation((table: string) => ({
            select: () => ({
                eq: () => ({
                    limit: async () => {
                        if (table === 'employee_accounts') {
                            return {
                                data: [{
                                    id: 'emp-1',
                                    username: 'cajero.aguero',
                                    password_hash: 'ClaveNueva999',
                                    owner_id: AGUERO_OWNER_ID,
                                    garage_id: AGUERO_GARAGE_ID,
                                    role: 'OPERATOR'
                                }],
                                error: null
                            };
                        }
                        return { data: [], error: null };
                    }
                })
            })
        } as any));

        const resStalePass = mockRes();
        await authController.login({
            body: { username: 'cajero.aguero', password: 'ClaveVieja123', garage_id: AGUERO_GARAGE_ID },
            headers: {}
        } as any, resStalePass);
        expect(resStalePass.status).toHaveBeenCalledWith(401);
        expect(resStalePass.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'INVALID_CREDENTIALS'
        }));

        // 3. Simular fallos variados de red (ENOTFOUND, ETIMEDOUT, ECONNREFUSED, HTTP 500, HTTP 503) en lectura de precios SQLite y NeDB
        await db.prices.insert({
            id: 'p-resilience-1',
            garageId: AGUERO_GARAGE_ID,
            vehicleTypeId: 'vt-auto',
            tariffId: 't-hora',
            amount: 4200,
            priceList: 'standard'
        } as any);

        const sqDb = SQLiteManager.getInstance().getDatabase();
        sqDb.prepare(`INSERT INTO prices (id, json_data) VALUES (?, ?)`).run(
            'p-resilience-1',
            JSON.stringify({ id: 'p-resilience-1', garageId: AGUERO_GARAGE_ID, vehicleTypeId: 'vt-auto', tariffId: 't-hora', amount: 4200, priceList: 'standard' })
        );

        const simulatedFailures = [
            Object.assign(new Error('getaddrinfo ENOTFOUND supabase.co'), { code: 'ENOTFOUND' }),
            Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
            Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
            { status: 500, message: 'Internal Server Error' },
            { status: 503, message: 'Service Unavailable' }
        ];

        const nedbRepo = new NeDBConfigRepository();
        const sqliteRepo = new SqliteConfigRepository();

        for (const failure of simulatedFailures) {
            vi.spyOn(supabase, 'from').mockImplementation(() => {
                throw failure;
            });
            const nedbPrices = await nedbRepo.getPrices(AGUERO_GARAGE_ID, 'standard');
            const sqlitePrices = await sqliteRepo.getPrices(AGUERO_GARAGE_ID, 'standard');
            expect(nedbPrices.length).toBe(1);
            expect(nedbPrices[0].amount).toBe(4200);
            expect(sqlitePrices.length).toBe(1);
            expect(sqlitePrices[0].amount).toBe(4200);
        }
    });

    it('Grupo C & D (Operación Completa Offline y Aislamiento Multi-Tenant en Realtime): Entrada, salida, cobro, cierre de caja y protección contra contaminación entre garajes', async () => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('NEDB');
        vi.spyOn(supabase, 'from').mockImplementation(() => {
            throw new TypeError('fetch failed');
        });

        await db.garages.insert({
            id: AGUERO_GARAGE_ID,
            ownerId: AGUERO_OWNER_ID,
            owner_id: AGUERO_OWNER_ID,
            name: 'Garaje Agüero'
        } as any);

        const sqDb = SQLiteManager.getInstance().getDatabase();
        sqDb.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run(
            AGUERO_GARAGE_ID,
            JSON.stringify({ id: AGUERO_GARAGE_ID, ownerId: AGUERO_OWNER_ID, name: 'Garaje Agüero' })
        );

        // 1. Entrada de vehículo offline, cobro/salida, movimiento de caja y cierre de turno
        const stayRepo = new StayRepository();
        const movementRepo = new MovementRepository();
        const shiftCloseRepo = new ShiftCloseRepository();

        const entryTime = new Date('2026-10-16T15:30:00.000Z');
        const exitTime = new Date('2026-10-16T17:15:00.000Z');

        await stayRepo.save({
            id: 'stay-offline-1',
            garageId: AGUERO_GARAGE_ID,
            plate: 'AG123CD',
            vehicleType: 'Auto',
            entryTime,
            active: true,
            ticket_code: 'AGU-0001'
        } as any);

        const activeStay = await stayRepo.findActiveByPlateOrTicket('AG123CD', AGUERO_GARAGE_ID);
        expect(activeStay).toBeTruthy();
        expect(activeStay?.plate).toBe('AG123CD');

        // Registrar salida y cobro offline
        await stayRepo.save({
            ...activeStay,
            exitTime,
            active: false,
            exit_authorized: true,
            amount: 7000
        } as any);

        await movementRepo.save({
            id: 'mov-stay-1',
            garageId: AGUERO_GARAGE_ID,
            type: 'CobroEstadia',
            plate: 'AG123CD',
            amount: 7000,
            paymentMethod: 'Efectivo',
            relatedEntityId: 'stay-offline-1',
            timestamp: exitTime,
            operator: 'Operador Agüero'
        } as any);

        await shiftCloseRepo.save({
            id: 'shift-close-1',
            garageId: AGUERO_GARAGE_ID,
            operator: 'Operador Agüero',
            timestamp: exitTime,
            totalInCash: 7000,
            stayingCount: 0
        } as any);

        // Verificar persistencia local e integridad de la cola de mutaciones
        const savedStay = await stayRepo.findById('stay-offline-1');
        expect(savedStay?.active).toBe(false);
        const savedMovements = await movementRepo.findAll(AGUERO_GARAGE_ID);
        expect(savedMovements.some((m: any) => m.id === 'mov-stay-1' && m.amount === 7000)).toBe(true);
        const savedCloses = await shiftCloseRepo.findAll(AGUERO_GARAGE_ID);
        expect(savedCloses.some((sc: any) => sc.id === 'shift-close-1')).toBe(true);

        const pendingMutations: any[] = await db.mutations.find({ status: 'PENDING' });
        expect(pendingMutations.length).toBeGreaterThanOrEqual(3);

        // 2. Aislamiento Multi-Tenant en Realtime (NeDB y SQLite):
        // Eventos de otro garaje / otro owner deben ser descartados
        const nedbSync = new NeDBSyncService();
        const sqliteSync = new SqliteSyncCoordinator();

        // Evento de tabla 'garages' de OTRO garaje (no tiene campo garage_id, sino id)
        await (nedbSync as any).handleRealtimePayload({
            table: 'garages',
            eventType: 'UPDATE',
            new: { id: OTHER_GARAGE_ID, owner_id: OTHER_OWNER_ID, name: 'Garaje Intruso' }
        }, AGUERO_GARAGE_ID);
        (sqliteSync as any).handleRealtimePayload({
            table: 'garages',
            eventType: 'UPDATE',
            new: { id: OTHER_GARAGE_ID, owner_id: OTHER_OWNER_ID, name: 'Garaje Intruso' }
        }, AGUERO_GARAGE_ID);

        // Evento de tabla 'employee_accounts' de OTRO owner con garage_id: null
        await (nedbSync as any).handleRealtimePayload({
            table: 'employee_accounts',
            eventType: 'INSERT',
            new: { id: 'emp-intruso', username: 'intruso', owner_id: OTHER_OWNER_ID, garage_id: null }
        }, AGUERO_GARAGE_ID);
        (sqliteSync as any).handleRealtimePayload({
            table: 'employee_accounts',
            eventType: 'INSERT',
            new: { id: 'emp-intruso', username: 'intruso', owner_id: OTHER_OWNER_ID, garage_id: null }
        }, AGUERO_GARAGE_ID);

        const nedbIntrusoGarage = await db.garages.findOne({ id: OTHER_GARAGE_ID });
        const nedbIntrusoEmp = await db.employees.findOne({ id: 'emp-intruso' });
        const sqliteIntrusoGarage = sqDb.prepare(`SELECT * FROM garages WHERE id = ?`).get(OTHER_GARAGE_ID);
        const sqliteIntrusoEmp = sqDb.prepare(`SELECT * FROM employees WHERE id = ?`).get('emp-intruso');

        expect(nedbIntrusoGarage).toBeNull();
        expect(nedbIntrusoEmp).toBeNull();
        expect(sqliteIntrusoGarage).toBeUndefined();
        expect(sqliteIntrusoEmp).toBeUndefined();
    });
});
