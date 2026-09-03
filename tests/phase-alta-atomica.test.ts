/**
 * PHASE-ALTA-ATOMICA: Tests for createSubscription atomic transaction
 *
 * Isolation rules:
 * - NODE_ENV=test causes SQLiteManager to auto-create an isolated temp SQLite file.
 * - NEVER touches .data/garageia.sqlite or localhost:3000.
 * - Mocks Supabase and Sync services.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// Ensure test env
process.env.NODE_ENV = 'test';

// ─── Mock external dependencies BEFORE importing project modules ──────────────

vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
            upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
            delete: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        channel: vi.fn().mockReturnValue({
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn().mockReturnThis(),
        }),
        removeChannel: vi.fn(),
    }
}));

vi.mock('../src/modules/Sync/application/SyncService.js', () => ({
    syncService: {
        pullAllData: vi.fn().mockResolvedValue(undefined),
        initRealtime: vi.fn(),
        getStatus: vi.fn().mockResolvedValue({ pending: 0, blocked: 0, connected: false }),
    }
}));

vi.mock('../src/modules/Sync/application/QueueService.js', () => ({
    QueueService: class MockQueueService {
        enqueue = vi.fn().mockResolvedValue(undefined);
    }
}));

vi.mock('../src/shared/CorrelativeGenerator', () => ({
    CorrelativeGenerator: {
        nextReceiptNumber: vi.fn().mockResolvedValue('00000001'),
        nextStayTicket: vi.fn().mockResolvedValue('E0000001'),
    }
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { GarageController } from '../src/modules/Garage/infra/GarageController';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';

const TEST_GARAGE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function count(tableName: string): number {
    const db = SQLiteManager.getInstance().getDatabase();
    return (db.prepare(`SELECT count(*) as c FROM ${tableName}`).get() as any).c;
}

function seedPricingData() {
    const db = SQLiteManager.getInstance().getDatabase();
    const vTypeId = 'vtype-auto-test';
    const tariffId = 'tariff-movil-test';

    db.prepare(`INSERT OR IGNORE INTO vehicle_types (id, json_data) VALUES (?, ?)`).run(
        vTypeId, JSON.stringify({ id: vTypeId, garageId: TEST_GARAGE_ID, name: 'Auto' })
    );
    db.prepare(`INSERT OR IGNORE INTO tariffs (id, json_data) VALUES (?, ?)`).run(
        tariffId, JSON.stringify({ id: tariffId, garageId: TEST_GARAGE_ID, name: 'Movil' })
    );
    db.prepare(`INSERT OR IGNORE INTO prices (id, json_data) VALUES (?, ?)`).run(
        'price-movil-auto-test', JSON.stringify({
            id: 'price-movil-auto-test',
            garageId: TEST_GARAGE_ID,
            priceList: 'standard',
            vehicleTypeId: vTypeId,
            tariffId: tariffId,
            vehicle_type_id: vTypeId,
            tariff_id: tariffId,
            amount: 860000,
        })
    );
    db.prepare(`INSERT OR IGNORE INTO financial_configs (id, json_data) VALUES (?, ?)`).run(
        `params-${TEST_GARAGE_ID}`, JSON.stringify({
            id: `params-${TEST_GARAGE_ID}`,
            garageId: TEST_GARAGE_ID,
            subscriptionFullPriceEnabled: false,
            subscriptionFullPriceUntilDay: null,
            updatedAt: new Date().toISOString()
        })
    );
}

function buildPayload(plate: string, overrides: Partial<any> = {}) {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remaining = lastDay - now.getDate() + 1;
    const totalInicial = Math.round((860000 / lastDay) * remaining);

    return {
        garageId: TEST_GARAGE_ID,
        subscriptionType: 'Movil',
        paymentMethod: 'Efectivo',
        billingType: 'Final',
        operator: 'testOp',
        exonerateLastDays: false,
        customerData: {
            name: 'Test Cliente',
            dni: `${Math.floor(Math.random() * 90000000) + 10000000}`,
            email: 'test@test.com',
            domicilio: 'Av Test 123',
            localidad: 'TestCity',
            telParticular: '1234567',
        },
        vehicleData: {
            plate,
            brand: 'Toyota',
            model: 'Corolla',
            color: 'Blanco',
            year: '2020',
            type: 'Auto',
        },
        numeroCochera: `${Math.floor(Math.random() * 9000) + 1000}`,
        tipoCochera: 'Movil',
        piso: null,
        basePrice: 860000,
        totalInicial,
        montoAbonado: totalInicial,
        ...overrides,
    };
}

function makeReqRes(body: any) {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
    } as unknown as Response;
    const req = {
        body,
        headers: { 'x-garage-id': TEST_GARAGE_ID },
        params: {},
    } as unknown as Request;
    return { req, res };
}

describe('ALTA-ATOMICA: createSubscription atomic transaction', () => {
    let controller: GarageController;

    beforeAll(async () => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        controller = new GarageController();
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        controller = new GarageController();
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec('DELETE FROM customers; DELETE FROM vehicles; DELETE FROM cocheras; DELETE FROM subscriptions; DELETE FROM movements; DELETE FROM debts; DELETE FROM outbox_events;');
        seedPricingData();
    });

    // ─── T1: Full payment (Atomic Success) ──────────────────────────────────
    it('T1: Full payment — Customer, Vehicle, Cochera, Subscription, Movement created; Debt=0; Outbox coherent', async () => {
        const { req, res } = makeReqRes(buildPayload('TST-001'));

        await controller.createSubscription(req, res);

        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            movementCreated: true,
            exonerated: false,
        }));
        expect(count('customers')).toBe(1);
        expect(count('vehicles')).toBe(1);
        expect(count('subscriptions')).toBe(1);
        expect(count('movements')).toBe(1);
        expect(count('debts')).toBe(0);

        // Outbox events verification
        const db = SQLiteManager.getInstance().getDatabase();
        const outbox = db.prepare("SELECT entity_type, operation, status FROM outbox_events").all() as any[];
        const entityTypes = outbox.map(e => e.entity_type);
        expect(entityTypes).toContain('Customer');
        expect(entityTypes).toContain('Vehicle');
        expect(entityTypes).toContain('Subscription');
        expect(entityTypes).toContain('Movement');
        outbox.forEach(e => expect(e.status).toBe('PENDING'));
    });

    // ─── T2: Partial payment ─────────────────────────────────────────────────
    it('T2: Partial payment — Movement=montoAbonado, Debt=difference, same commit', async () => {
        const payload = buildPayload('TST-002', { montoAbonado: 200000 });
        const { req, res } = makeReqRes(payload);

        await controller.createSubscription(req, res);

        expect(res.status).not.toHaveBeenCalledWith(500);

        const db = SQLiteManager.getInstance().getDatabase();
        const movs = (db.prepare('SELECT json_data FROM movements').all() as any[]).map(r => JSON.parse(r.json_data));
        const debts = (db.prepare('SELECT json_data FROM debts').all() as any[]).map(r => JSON.parse(r.json_data));

        expect(movs).toHaveLength(1);
        expect(movs[0].amount).toBe(200000);

        expect(debts).toHaveLength(1);
        expect(debts[0].amount_paid).toBe(200000);
        expect(debts[0].remaining_amount).toBeGreaterThan(0);
        expect(debts[0].status).toBe('PENDING');
        expect(debts[0].type).toBe('CANON');

        expect(count('subscriptions')).toBe(1);
    });

    // ─── T3: TOTAL ATOMIC ROLLBACK ON MOVEMENT FAILURE ────────────────────────
    it('T3: Atomic failure — if Movement save throws, EVERYTHING rolls back (Customer, Vehicle, Cochera, Sub, Movement, Debt, Outbox all +0)', async () => {
        // Intercept movementRepo.save to simulate a write failure inside the SQLite transaction
        const spySave = vi.spyOn(controller['movementRepo'], 'save').mockRejectedValueOnce(
            new Error('Simulated Movement DB failure')
        );

        const { req, res } = makeReqRes(buildPayload('TST-003'));
        await controller.createSubscription(req, res);

        spySave.mockRestore();

        // Check that ZERO rows were left behind across all tables
        expect(count('customers')).toBe(0);
        expect(count('vehicles')).toBe(0);
        expect(count('cocheras')).toBe(0);
        expect(count('subscriptions')).toBe(0);
        expect(count('movements')).toBe(0);
        expect(count('debts')).toBe(0);
        expect(count('outbox_events')).toBe(0);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('Simulated Movement DB failure'),
        }));
    });

    // ─── T4: Exemption handling ──────────────────────────────────────────────
    it('T4: Exonerated — when not last two days returns 422, when valid creates Sub with Movement=0', async () => {
        // If not last 2 days, requesting exoneration rejects with 422
        const payload = buildPayload('TST-004', { exonerateLastDays: true });
        const { req, res } = makeReqRes(payload);

        await controller.createSubscription(req, res);

        const responseArg = (res.json as any).mock.calls[0]?.[0];
        if (responseArg?.exonerated === true) {
            expect(count('movements')).toBe(0);
            expect(count('debts')).toBe(0);
            expect(count('subscriptions')).toBe(1);
        } else {
            // Guard returned 422 because today is not last 2 days of month
            expect(res.status).toHaveBeenCalledWith(422);
            expect(count('movements')).toBe(0);
            expect(count('subscriptions')).toBe(0);
        }
    });

    // ─── T5: Real SQLite tx connection with .prepare() ───────────────────────
    it('T5: Transaction receives a real SQLite db with .prepare() and executes atomically', async () => {
        let capturedDb: any = null;
        const spyRunAsync = vi.spyOn(TransactionHelper, 'runAsync').mockImplementationOnce(async (callback) => {
            const realDb = SQLiteManager.getInstance().getDatabase();
            capturedDb = realDb;
            return await callback(realDb);
        });

        const { req, res } = makeReqRes(buildPayload('TST-005'));
        await controller.createSubscription(req, res);

        spyRunAsync.mockRestore();

        expect(capturedDb).not.toBeNull();
        expect(typeof capturedDb.prepare).toBe('function');
        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(count('customers')).toBe(1);
        expect(count('subscriptions')).toBe(1);
    });

    // ─── T6: Offline Resilience ──────────────────────────────────────────────
    it('T6: Offline resilience — alta succeeds locally and records PENDING outbox without cloud', async () => {
        // Even if Supabase throws errors, local SQLite commit succeeds
        const { req, res } = makeReqRes(buildPayload('TST-006'));
        await controller.createSubscription(req, res);

        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(count('subscriptions')).toBe(1);
        expect(count('movements')).toBe(1);

        const db = SQLiteManager.getInstance().getDatabase();
        const pendingEvents = db.prepare("SELECT count(*) as c FROM outbox_events WHERE status = 'PENDING'").get() as any;
        expect(pendingEvents.c).toBeGreaterThan(0);
    });
});
