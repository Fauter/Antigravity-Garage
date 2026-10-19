import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { supabaseMockState, resetSupabaseMock } = vi.hoisted(() => {
    const state = {
        mode: 'ONLINE' as 'ONLINE' | 'OFFLINE_FETCH_FAILED' | 'PARTIAL_TABLE_FAILURE',
        delayMs: 0,
        failingTables: new Set<string>(),
        upsertedRows: [] as Array<{ table: string; payload: any }>,
        remoteTables: {} as Record<string, any[]>
    };

    const reset = () => {
        state.mode = 'ONLINE';
        state.delayMs = 0;
        state.failingTables.clear();
        state.upsertedRows = [];
        state.remoteTables = {};
    };

    return { supabaseMockState: state, resetSupabaseMock: reset };
});

vi.mock('../src/infrastructure/lib/supabase.js', () => {
    const makeError = (table: string) => {
        if (supabaseMockState.mode === 'OFFLINE_FETCH_FAILED') {
            return new TypeError('fetch failed');
        }
        if (supabaseMockState.mode === 'PARTIAL_TABLE_FAILURE' && supabaseMockState.failingTables.has(table)) {
            return { message: `Simulated remote error on table ${table}`, code: '500' };
        }
        return null;
    };

    const createQueryBuilder = (table: string) => {
        const filters: Array<{ col: string; val: any }> = [];
        const execute = async () => {
            if (supabaseMockState.delayMs > 0) {
                await new Promise((r) => setTimeout(r, supabaseMockState.delayMs));
            }
            const err = makeError(table);
            if (err) {
                if (err instanceof TypeError) throw err;
                return { data: null, error: err };
            }
            let rows = [...(supabaseMockState.remoteTables[table] || [])];
            for (const f of filters) {
                rows = rows.filter((r) => String(r[f.col] ?? '') === String(f.val ?? ''));
            }
            return { data: rows, error: null };
        };

        const builder: any = {
            select: vi.fn(() => builder),
            eq: vi.fn((col: string, val: any) => {
                filters.push({ col, val });
                return builder;
            }),
            gte: vi.fn(() => builder),
            order: vi.fn(() => builder),
            range: vi.fn(() => builder),
            single: vi.fn(async () => {
                const res = await execute();
                if (res.error) return res;
                return {
                    data: res.data?.[0] || null,
                    error: res.data?.[0] ? null : { message: 'No rows', code: 'PGRST116' }
                };
            }),
            upsert: vi.fn(async (payload: any) => {
                const err = makeError(table);
                if (err) {
                    if (err instanceof TypeError) throw err;
                    return { data: null, error: err };
                }
                supabaseMockState.upsertedRows.push({ table, payload });
                return { data: payload, error: null };
            }),
            delete: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: null, error: null }))
            })),
            then: (onFulfilled: any, onRejected: any) => execute().then(onFulfilled, onRejected)
        };
        return builder;
    };

    return {
        SUPABASE_URL: 'https://mock.supabase.co',
        supabase: {
            from: vi.fn((table: string) => createQueryBuilder(table)),
            channel: vi.fn(() => ({
                on: vi.fn().mockReturnThis(),
                subscribe: vi.fn().mockReturnThis()
            })),
            removeChannel: vi.fn()
        }
    };
});

import Datastore from 'nedb-promises';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine.js';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager.js';
import { TerminalConfigManager } from '../src/infrastructure/config/TerminalConfigManager.js';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator.js';
import { NeDBSyncService } from '../src/modules/Sync/application/SyncService.js';
import { probeLocalData, probeLocalDataUnified } from '../src/modules/Sync/application/LocalDataProbe.js';
import { MovementRepository } from '../src/modules/Billing/infra/MovementRepository.js';
import { SqliteConfigRepository } from '../src/modules/Configuration/infra/SqliteConfigRepository.js';
import { PricingEngine } from '../src/modules/Billing/domain/PricingEngine.js';
import { OpsLogger } from '../src/shared/OpsLogger.js';
import { db, DATA_DIR } from '../src/infrastructure/database/datastore.js';

const GARAGE_ID = 'ebf7eaa0-339e-455f-bcde-dd51636e1f21';
const OWNER_ID = '77777777-8888-4999-aaaa-bbbbbbbbbbbb';

function seedCompleteRemoteSupabaseData(garageId = GARAGE_ID, ownerId = OWNER_ID) {
    supabaseMockState.remoteTables = {
        garages: [{ id: garageId, owner_id: ownerId, name: 'Garaje Agüero', address: 'Agüero 1234' }],
        customers: [{ id: 'cust-1', garage_id: garageId, name: 'Cliente Uno', updated_at: '2026-10-16T12:00:00.000Z' }],
        subscriptions: [{ id: 'sub-1', garage_id: garageId, customer_id: 'cust-1', type: 'Movil', price: 45000, active: true, updated_at: '2026-10-16T12:00:00.000Z' }],
        vehicles: [{ id: 'veh-1', garage_id: garageId, plate: 'AA123BB', type: 'Auto', updated_at: '2026-10-16T12:00:00.000Z' }],
        stays: [{ id: 'stay-1', garage_id: garageId, plate: 'AA123BB', vehicle_type: 'Auto', entry_time: '2026-10-16T14:00:00.000Z', active: true, updated_at: '2026-10-16T14:00:00.000Z' }],
        employee_accounts: [{ id: 'emp-1', owner_id: ownerId, garage_id: garageId, username: 'cajero.aguero', first_name: 'Carlos', last_name: 'Gomez', role: 'OPERATOR', active: true }],
        cocheras: [{ id: 'coch-1', garage_id: garageId, tipo: 'Movil', numero: '101', status: 'Ocupada', updated_at: '2026-10-16T12:00:00.000Z' }],
        debts: [{ id: 'debt-1', garage_id: garageId, customer_id: 'cust-1', amount: 45000, status: 'PENDING', updated_at: '2026-10-16T12:00:00.000Z' }],
        incidents: [{ id: 'inc-1', garage_id: garageId, description: 'Barrera revisada', created_at: '2026-10-16T12:00:00.000Z' }],
        vehicle_types: [{ id: 'vt-auto', garage_id: garageId, name: 'Auto', active: true }],
        tariffs: [
            { id: 'tar-hora', garage_id: garageId, name: 'Hora', type: 'hora', hours: 1, minutes: 0, days: 0, sort_order: 1 },
            { id: 'tar-estadia', garage_id: garageId, name: 'Estadía 24hs', type: 'turno', hours: 24, minutes: 0, days: 1, sort_order: 2 }
        ],
        prices: [
            { id: 'pr-std-hora', garage_id: garageId, vehicle_type_id: 'vt-auto', tariff_id: 'tar-hora', amount: 3500, price_list: 'standard' },
            { id: 'pr-std-est', garage_id: garageId, vehicle_type_id: 'vt-auto', tariff_id: 'tar-estadia', amount: 18000, price_list: 'standard' }
        ],
        financial_configs: [{ id: `fc-${garageId}`, garage_id: garageId, initial_tolerance: 15, fractionate_after: 60, surcharge_percentage: 10 }],
        building_levels: [{ id: 'lvl-pb', garage_id: garageId, name: 'Planta Baja', sort_order: 1 }],
        movements: [{ id: 'mov-1', garage_id: garageId, type: 'CobroEstadia', amount: 3500, payment_method: 'Efectivo', timestamp: '2026-10-16T14:30:00.000Z', updated_at: '2026-10-16T14:30:00.000Z' }],
        shift_closes: [{ id: 'sc-1', garage_id: garageId, operator: 'Carlos Gomez', total_in_cash: 3500, timestamp: '2026-10-16T14:45:00.000Z', updated_at: '2026-10-16T14:45:00.000Z' }],
        partial_closes: [{ id: 'pc-1', garage_id: garageId, operator: 'Carlos Gomez', amount: 1000, timestamp: '2026-10-16T14:40:00.000Z', updated_at: '2026-10-16T14:40:00.000Z' }],
        promos: [{ id: 'promo-1', garage_id: garageId, name: 'Convenio', discount_pct: 10 }]
    };
}

describe('P0 Regression Suite — Initial Bootstrap Gate & Data Readiness State Machine', () => {
    const testConfigDir = path.join(DATA_DIR, 'test');
    const configFilePath = path.join(testConfigDir, 'terminal-config.json');
    const backupFilePath = `${configFilePath}.bak`;

    beforeEach(async () => {
        resetSupabaseMock();
        if (!fs.existsSync(testConfigDir)) {
            fs.mkdirSync(testConfigDir, { recursive: true });
        }
        if (fs.existsSync(configFilePath)) fs.unlinkSync(configFilePath);
        if (fs.existsSync(backupFilePath)) fs.unlinkSync(backupFilePath);

        db.garages = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.employees = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.vehicleTypes = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.tariffs = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.prices = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.stays = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.movements = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.shiftCloses = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.mutations = Datastore.create({ inMemoryOnly: true, timestampData: true });
        db.syncState = Datastore.create({ inMemoryOnly: true, timestampData: true });
        (db as any).configs = Datastore.create({ inMemoryOnly: true, timestampData: true });

        SQLiteManager.initForTest();
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (fs.existsSync(configFilePath)) fs.unlinkSync(configFilePath);
        if (fs.existsSync(backupFilePath)) fs.unlinkSync(backupFilePath);
    });

    it('Prueba 1 — Login online con sincronización en progreso: bloquea readiness mientras dura el bootstrap, deduplica llamadas concurrentes y recién habilita ready al finalizar', async () => {
        seedCompleteRemoteSupabaseData();
        supabaseMockState.delayMs = 20; // Simula latencia real en cada tabla durante el bootstrap

        const coordinator = new SqliteSyncCoordinator();
        const sqDb = SQLiteManager.getInstance().getDatabase();

        // Antes del bootstrap, la base local no está lista
        const beforeProbe = probeLocalData(sqDb, GARAGE_ID);
        expect(beforeProbe.hasLocalData).toBe(false);

        // Lanzamos el ciclo de bootstrap y una segunda llamada concurrente (ej. background + manual bootstrap)
        let syncFinished = false;
        const syncPromise1 = coordinator.runSyncCycle(GARAGE_ID, 'STARTUP').then((res) => {
            syncFinished = true;
            return res;
        });

        // Damos 30ms para que el ciclo esté a mitad de camino
        await new Promise((r) => setTimeout(r, 30));
        expect(syncFinished).toBe(false);
        expect(coordinator.isGlobalSyncing).toBe(true);

        // Una llamada concurrente a runSyncCycle (como POST /api/sync/bootstrap) NO debe resolver en 0ms con falso SUCCESS,
        // sino unirse a la promesa activa y esperar a que termine realmente.
        const concurrentStart = Date.now();
        const syncPromise2 = coordinator.runSyncCycle(GARAGE_ID, 'MANUAL_BOOTSTRAP');

        const [res1, res2] = await Promise.all([syncPromise1, syncPromise2]);
        const concurrentElapsed = Date.now() - concurrentStart;

        expect(concurrentElapsed).toBeGreaterThanOrEqual(20);
        expect(res1.status).toBe('SUCCESS');
        expect(res1.failedTables).toEqual([]);
        expect(res2.status).toBe('SUCCESS');
        expect(res2.failedTables).toEqual([]);

        // Ahora que el bootstrap terminó, hasLocalData e isBootstrapComplete deben ser true
        const afterProbe = await probeLocalDataUnified(() => sqDb, GARAGE_ID);
        expect(afterProbe.hasLocalData).toBe(true);
        expect(afterProbe.isBootstrapComplete).toBe(true);
        expect(afterProbe.missing).toEqual([]);

        // Verificamos también que employee_accounts se sincronizó en el PRIMER ciclo gracias a que garages se descarga primero
        const employeesRows = sqDb.prepare(`SELECT json_data FROM employees`).all() as any[];
        expect(employeesRows.length).toBe(1);
        expect(JSON.parse(employeesRows[0].json_data).username).toBe('cajero.aguero');
    });

    it('Prueba 2 — Login online con datos locales parciales: detecta bootstrap incompleto y exige completar todas las tablas antes de declarar hasLocalData=true', async () => {
        seedCompleteRemoteSupabaseData();
        const sqDb = SQLiteManager.getInstance().getDatabase();

        // Simulamos un estado local parcial donde existen las 4 tablas de configuración y el checkpoint de customers,
        // pero faltan los checkpoints de stays/movements/shift_closes (bootstrap previo interrumpido)
        sqDb.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run(GARAGE_ID, JSON.stringify({ id: GARAGE_ID, ownerId: OWNER_ID, name: 'Garaje Agüero' }));
        sqDb.prepare(`INSERT INTO vehicle_types (id, json_data) VALUES (?, ?)`).run('vt-auto', JSON.stringify({ id: 'vt-auto', garageId: GARAGE_ID, name: 'Auto' }));
        sqDb.prepare(`INSERT INTO tariffs (id, json_data) VALUES (?, ?)`).run('tar-hora', JSON.stringify({ id: 'tar-hora', garageId: GARAGE_ID, name: 'Hora' }));
        sqDb.prepare(`INSERT INTO prices (id, json_data) VALUES (?, ?)`).run('pr-std-hora', JSON.stringify({ id: 'pr-std-hora', garageId: GARAGE_ID, amount: 3500 }));
        sqDb.prepare(`INSERT INTO sync_checkpoints (collection_name, last_synced_at) VALUES (?, ?)`).run(`${GARAGE_ID}_customers`, new Date().toISOString());

        const partialProbe = await probeLocalDataUnified(() => sqDb, GARAGE_ID);
        expect(partialProbe.checks.garageRow).toBe(true);
        expect(partialProbe.checks.vehicleTypes).toBe(true);
        expect(partialProbe.checks.tariffs).toBe(true);
        expect(partialProbe.checks.prices).toBe(true);
        expect(partialProbe.isBootstrapComplete).toBe(false);
        expect(partialProbe.hasLocalData).toBe(false);
        expect(partialProbe.missing).toContain('Sincronización inicial completa');

        // Al completarse el bootstrap online, pasa a hasLocalData=true e isBootstrapComplete=true
        const coordinator = new SqliteSyncCoordinator();
        const syncRes = await coordinator.runSyncCycle(GARAGE_ID, 'MANUAL_BOOTSTRAP');
        expect(syncRes.status).toBe('SUCCESS');

        const completeProbe = await probeLocalDataUnified(() => sqDb, GARAGE_ID);
        expect(completeProbe.isBootstrapComplete).toBe(true);
        expect(completeProbe.hasLocalData).toBe(true);
        expect(completeProbe.missing).toEqual([]);
    });

    it('Prueba 3 — Login offline con snapshot local completo: permite ingreso inmediato con datos locales íntegros sin depender de red remota', async () => {
        seedCompleteRemoteSupabaseData();
        const coordinator = new SqliteSyncCoordinator();
        const sqDb = SQLiteManager.getInstance().getDatabase();

        // 1. Primer bootstrap exitoso con internet
        const initialRes = await coordinator.runSyncCycle(GARAGE_ID, 'MANUAL_BOOTSTRAP');
        expect(initialRes.status).toBe('SUCCESS');

        // 2. Cae internet por completo
        supabaseMockState.mode = 'OFFLINE_FETCH_FAILED';

        // 3. La sonda de readiness confirma snapshot local completo (hasLocalData=true)
        const offlineProbe = await probeLocalDataUnified(() => sqDb, GARAGE_ID);
        expect(offlineProbe.hasLocalData).toBe(true);
        expect(offlineProbe.isBootstrapComplete).toBe(true);

        // 4. Los repositorios locales operan 100% offline sin Matrix Received (Keys): []
        const configRepo = new SqliteConfigRepository();
        const [vts, tariffs, prices] = await Promise.all([
            configRepo.getVehicleTypes(GARAGE_ID),
            configRepo.getTariffs(GARAGE_ID),
            configRepo.getPrices(GARAGE_ID, 'EFECTIVO')
        ]);
        const fCfgRow = sqDb.prepare(`SELECT json_data FROM financial_configs WHERE json_extract(json_data, '$.garageId') = ?`).get(GARAGE_ID) as any;
        expect(vts.length).toBeGreaterThan(0);
        expect(tariffs.length).toBeGreaterThan(0);
        expect(prices.length).toBeGreaterThan(0);
        expect(fCfgRow).toBeDefined();
    });

    it('Prueba 4 — Login offline con datos locales incompletos: rechaza declarar ready y reporta exactamente los datasets faltantes', async () => {
        supabaseMockState.mode = 'OFFLINE_FETCH_FAILED';
        const sqDb = SQLiteManager.getInstance().getDatabase();

        // Sólo existe el garaje y tipos de vehículo, pero faltan tarifas y matriz de precios
        sqDb.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run(GARAGE_ID, JSON.stringify({ id: GARAGE_ID, ownerId: OWNER_ID, name: 'Garaje Agüero' }));
        sqDb.prepare(`INSERT INTO vehicle_types (id, json_data) VALUES (?, ?)`).run('vt-auto', JSON.stringify({ id: 'vt-auto', garageId: GARAGE_ID, name: 'Auto' }));

        const coordinator = new SqliteSyncCoordinator();
        const syncRes = await coordinator.runSyncCycle(GARAGE_ID, 'MANUAL_BOOTSTRAP');
        expect(syncRes.status).toBe('FAILED');
        expect(syncRes.failedTables.length).toBe(SqliteSyncCoordinator.tableMappings.length);

        const readiness = await probeLocalDataUnified(() => sqDb, GARAGE_ID);
        expect(readiness.hasLocalData).toBe(false);
        expect(readiness.isBootstrapComplete).toBe(false);
        expect(readiness.missing).toContain('Tarifas');
        expect(readiness.missing).toContain('Precios');
    });

    it('Prueba 5 — Fallo parcial de tablas durante bootstrap: NO emite SYNC_SUCCESS, no avanza el checkpoint de la tabla fallida y marca el bootstrap como incompleto', async () => {
        seedCompleteRemoteSupabaseData();
        supabaseMockState.mode = 'PARTIAL_TABLE_FAILURE';
        supabaseMockState.failingTables.add('prices');
        supabaseMockState.failingTables.add('stays');

        const infoSpy = vi.spyOn(OpsLogger, 'info');
        const warnSpy = vi.spyOn(OpsLogger, 'warn');

        const coordinator = new SqliteSyncCoordinator();
        const sqDb = SQLiteManager.getInstance().getDatabase();

        const syncRes = await coordinator.runSyncCycle(GARAGE_ID, 'MANUAL_BOOTSTRAP');
        expect(syncRes.status).toBe('WITH_WARNINGS');
        expect(syncRes.failedTables).toContain('prices');
        expect(syncRes.failedTables).toContain('stays');

        // Invariante: NUNCA debe emitirse SYNC_SUCCESS cuando fallaron tablas
        const syncSuccessCalls = [
            ...infoSpy.mock.calls.filter((c) => (c[0] as any)?.operation === 'SYNC_SUCCESS'),
            ...warnSpy.mock.calls.filter((c) => (c[0] as any)?.operation === 'SYNC_SUCCESS')
        ];
        expect(syncSuccessCalls.length).toBe(0);

        // Los checkpoints de las tablas fallidas NO deben haberse escrito
        const pricesCp = sqDb.prepare(`SELECT 1 FROM sync_checkpoints WHERE collection_name = ?`).get(`${GARAGE_ID}_prices`);
        const staysCp = sqDb.prepare(`SELECT 1 FROM sync_checkpoints WHERE collection_name = ?`).get(`${GARAGE_ID}_stays`);
        expect(pricesCp).toBeUndefined();
        expect(staysCp).toBeUndefined();

        // Debe existir el marcador __bootstrap_incomplete y hasLocalData debe ser false
        const incompleteMarker = sqDb.prepare(`SELECT 1 FROM sync_checkpoints WHERE collection_name = ?`).get(`${GARAGE_ID}__bootstrap_incomplete`);
        expect(incompleteMarker).toBeDefined();

        const readiness = await probeLocalDataUnified(() => sqDb, GARAGE_ID);
        expect(readiness.hasLocalData).toBe(false);
        expect(readiness.isBootstrapComplete).toBe(false);
    });

    it('Prueba 6 — Reinicio durante corte y posterior reconexión: preserva configuración, opera con snapshot previo y al reconectar hace PUSH de outbox antes de PULL', async () => {
        seedCompleteRemoteSupabaseData();
        const coordinator = new SqliteSyncCoordinator();
        const sqDb = SQLiteManager.getInstance().getDatabase();
        const movementRepo = new MovementRepository();

        TerminalConfigManager.setConfig({
            garage_id: GARAGE_ID,
            owner_id: OWNER_ID,
            name: 'Garaje Agüero',
            address: 'Agüero 1234'
        });

        // 1. Bootstrap inicial online exitoso
        await coordinator.runSyncCycle(GARAGE_ID, 'MANUAL_BOOTSTRAP');
        expect((await probeLocalDataUnified(() => sqDb, GARAGE_ID)).hasLocalData).toBe(true);

        // 2. Corte de internet + cobro local encolado en outbox_events via MovementRepository
        supabaseMockState.mode = 'OFFLINE_FETCH_FAILED';
        await movementRepo.save({
            id: 'mov-offline-reconn-1',
            garageId: GARAGE_ID,
            type: 'CobroEstadia',
            amount: 3500,
            paymentMethod: 'Efectivo',
            timestamp: new Date().toISOString()
        } as any);

        // Incluso si ocurre un intento de sync durante el corte, el snapshot previo sigue siendo válido (hasLocalData=true)
        const failedBgRes = await coordinator.runSyncCycle(GARAGE_ID, 'PERIODIC');
        expect(failedBgRes.status).toBe('FAILED');
        expect((await probeLocalDataUnified(() => sqDb, GARAGE_ID)).hasLocalData).toBe(true);
        expect(TerminalConfigManager.getConfig()?.garage_id).toBe(GARAGE_ID);

        // 3. Vuelve internet -> el ciclo de reconexión empuja outbox_events a Supabase y reconcilia deltas
        supabaseMockState.mode = 'ONLINE';
        const reconnRes = await coordinator.runSyncCycle(GARAGE_ID, 'BACKGROUND_RECONNECT');
        expect(reconnRes.status).toBe('SUCCESS');
        expect(supabaseMockState.upsertedRows.some((u) => u.table === 'movements' && u.payload.id === 'mov-offline-reconn-1')).toBe(true);

        const ackedRow = sqDb.prepare(`SELECT status FROM outbox_events WHERE entity_id = 'mov-offline-reconn-1'`).get() as any;
        expect(ackedRow?.status).toBe('ACKED');
    });

    it('Prueba 7 — Disponibilidad inmediata en Caja tras alcanzar ready: estadías, movimientos, cierres de caja y matriz de precios están hidratados en el motor activo', async () => {
        seedCompleteRemoteSupabaseData();
        const coordinator = new SqliteSyncCoordinator();
        const sqDb = SQLiteManager.getInstance().getDatabase();

        const res = await coordinator.runSyncCycle(GARAGE_ID, 'MANUAL_BOOTSTRAP');
        expect(res.status).toBe('SUCCESS');

        const readiness = await probeLocalDataUnified(() => sqDb, GARAGE_ID);
        expect(readiness.hasLocalData).toBe(true);

        // Verificamos que todos los datasets que consulta CajaPage al montar están presentes en SQLite
        const stays = sqDb.prepare(`SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?`).all(GARAGE_ID) as any[];
        const movements = sqDb.prepare(`SELECT json_data FROM movements WHERE json_extract(json_data, '$.garageId') = ?`).all(GARAGE_ID) as any[];
        const shiftCloses = sqDb.prepare(`SELECT json_data FROM shift_closes WHERE json_extract(json_data, '$.garageId') = ?`).all(GARAGE_ID) as any[];
        const partialCloses = sqDb.prepare(`SELECT json_data FROM partial_closes WHERE json_extract(json_data, '$.garageId') = ?`).all(GARAGE_ID) as any[];
        const cocheras = sqDb.prepare(`SELECT json_data FROM cocheras WHERE json_extract(json_data, '$.garageId') = ?`).all(GARAGE_ID) as any[];

        expect(stays.length).toBe(1);
        expect(movements.length).toBe(1);
        expect(shiftCloses.length).toBe(1);
        expect(partialCloses.length).toBe(1);
        expect(cocheras.length).toBe(1);

        // Y el motor de cotización de Caja puede cotizar inmediatamente sin errores de matriz vacía
        const configRepo = new SqliteConfigRepository();
        const [vts, tariffs, prices] = await Promise.all([
            configRepo.getVehicleTypes(GARAGE_ID),
            configRepo.getTariffs(GARAGE_ID),
            configRepo.getPrices(GARAGE_ID, 'EFECTIVO')
        ]);
        const fCfgRow = sqDb.prepare(`SELECT json_data FROM financial_configs WHERE json_extract(json_data, '$.garageId') = ?`).get(GARAGE_ID) as any;
        const fCfg = fCfgRow ? JSON.parse(fCfgRow.json_data) : null;

        const vtMap: Record<string, string> = {};
        vts.forEach((v) => { vtMap[v.id] = v.name.toLowerCase(); });
        const tMap: Record<string, string> = {};
        tariffs.forEach((t) => { tMap[t.id] = t.name.toLowerCase(); });

        const matrix: Record<string, Record<string, number>> = {};
        for (const p of prices) {
            const vName = vtMap[(p as any).vehicleTypeId || (p as any).vehicle_type_id];
            const tName = tMap[(p as any).tariffId || (p as any).tariff_id];
            if (vName && tName) {
                if (!matrix[vName]) matrix[vName] = {};
                matrix[vName][tName] = Number((p as any).price ?? (p as any).amount ?? 0);
            }
        }

        const engine = new PricingEngine(
            { getAll: async () => tariffs },
            { getParams: async () => ({ gracePeriodMinutes: 10, fractionateAfter: fCfg?.fractionateAfter ?? 0, initialTolerance: fCfg?.initialTolerance ?? 5 }) },
            { getPrices: async () => matrix }
        );
        const quote = await engine.calculateParkingFee(
            { entryTime: new Date('2026-10-16T14:00:00.000Z'), plate: 'AA123BB', vehicleType: 'Auto' },
            new Date('2026-10-16T14:50:00.000Z'),
            'Efectivo'
        );
        expect(quote.price).toBe(3500);
    });

    it('FRONTEND STATE MACHINE (Casos A–E): executeInitialSyncFlow enforces syncing -> warmup -> ready and blocks ready on partial/offline incomplete states', async () => {
        const { executeInitialSyncFlow } = await import('../src/frontend/src/context/AuthContext');
        type SyncState = 'idle' | 'syncing' | 'warmup' | 'ready' | 'offline' | 'timeout' | 'error';

        // Caso A & B: Login ONLINE con datos previos -> NO consulta has-local-data para saltar, espera bootstrap y warmup antes de ready
        const statesAB: SyncState[] = [];
        let bootstrapResolved = false;
        let resolveBootstrap!: (val: any) => void;
        const bootstrapPromise = new Promise((res) => { resolveBootstrap = res; });

        const flowAB = executeInitialSyncFlow({
            garageId: GARAGE_ID,
            authMode: 'ONLINE_SUPABASE',
            signal: new AbortController().signal,
            apiGet: vi.fn(async () => ({ data: { hasLocalData: true, missing: [] } })),
            apiPost: vi.fn(() => bootstrapPromise),
            runWarmupAndNotify: async () => {
                statesAB.push('warmup');
            },
            setInitialSyncState: (s) => statesAB.push(s),
            setIsGlobalSyncing: () => {},
            setReadinessDiagnostics: () => {}
        });

        // While bootstrap is in-flight, state must strictly be 'syncing' (never 'ready')
        expect(statesAB).toEqual(['syncing']);
        expect(bootstrapResolved).toBe(false);

        bootstrapResolved = true;
        resolveBootstrap({
            data: {
                status: 'READY',
                failedTables: [],
                readiness: { hasLocalData: true, missing: [] }
            }
        });
        await flowAB;
        expect(statesAB).toEqual(['syncing', 'warmup', 'ready']);

        // Caso C: Login OFFLINE con datos completos -> verifica has-local-data, ejecuta warmup y pasa a ready
        const statesC: SyncState[] = [];
        await executeInitialSyncFlow({
            garageId: GARAGE_ID,
            authMode: 'OFFLINE_LOCAL',
            signal: new AbortController().signal,
            apiGet: vi.fn(async () => ({ data: { hasLocalData: true, missing: [] } })),
            apiPost: vi.fn(),
            runWarmupAndNotify: async () => {
                statesC.push('warmup');
            },
            setInitialSyncState: (s) => statesC.push(s),
            setIsGlobalSyncing: () => {},
            setReadinessDiagnostics: () => {}
        });
        expect(statesC).toEqual(['syncing', 'warmup', 'ready']);

        // Caso D: Login OFFLINE con datos incompletos -> queda en 'offline' y hasLocalData=false (sin auto-transición a ready)
        const statesD: SyncState[] = [];
        let diagD: any = null;
        await executeInitialSyncFlow({
            garageId: GARAGE_ID,
            authMode: 'OFFLINE_LOCAL',
            signal: new AbortController().signal,
            apiGet: vi.fn(async () => ({ data: { hasLocalData: false, missing: ['tarifas', 'tipos de vehículo'] } })),
            apiPost: vi.fn(),
            runWarmupAndNotify: async () => {
                statesD.push('warmup');
            },
            setInitialSyncState: (s) => statesD.push(s),
            setIsGlobalSyncing: () => {},
            setReadinessDiagnostics: (d) => { diagD = d; }
        });
        expect(statesD).toEqual(['syncing', 'offline']);
        expect(diagD?.hasLocalData).toBe(false);
        expect(diagD?.missing).toContain('tarifas');

        // Caso E: Falla parcial en bootstrap (HTTP 502) -> pasa a 'error' y reporta tablas fallidas
        const statesE: SyncState[] = [];
        let diagE: any = null;
        await executeInitialSyncFlow({
            garageId: GARAGE_ID,
            authMode: 'ONLINE_SUPABASE',
            signal: new AbortController().signal,
            apiGet: vi.fn(),
            apiPost: vi.fn(async () => {
                const err: any = new Error('Partial failure');
                err.response = {
                    status: 502,
                    data: {
                        status: 'PARTIAL_FAILURE',
                        failedTables: ['stays', 'movements'],
                        readiness: { hasLocalData: false, missing: ['sincronización inicial completa (stays, movements)'] }
                    }
                };
                throw err;
            }),
            runWarmupAndNotify: async () => {
                statesE.push('warmup');
            },
            setInitialSyncState: (s) => statesE.push(s),
            setIsGlobalSyncing: () => {},
            setReadinessDiagnostics: (d) => { diagE = d; }
        });
        expect(statesE).toEqual(['syncing', 'error']);
        expect(diagE?.failedTables).toEqual(['stays', 'movements']);
        expect(diagE?.hasLocalData).toBe(false);
    });
});

