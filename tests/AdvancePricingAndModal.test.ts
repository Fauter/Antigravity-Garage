process.env.DB_ENGINE = 'SQLITE';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GarageController } from '../src/modules/Garage/infra/GarageController';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SqliteSubscriptionRepository } from '../src/modules/Garage/infra/SqliteSubscriptionRepository';
import { SqliteMovementRepository } from '../src/modules/Billing/infra/SqliteMovementRepository';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import { SqliteCustomerRepository } from '../src/modules/Garage/infra/SqliteCustomerRepository';
import { SqliteVehicleRepository } from '../src/modules/Garage/infra/SqliteVehicleRepository';
import { SqliteCocheraRepository } from '../src/modules/Garage/infra/SqliteCocheraRepository';
import { v4 as uuidv4 } from 'uuid';

describe('ADVANCE Pricing and Invariants Tests', () => {
    let controller: GarageController;
    let subRepo: SqliteSubscriptionRepository;
    let movementRepo: SqliteMovementRepository;
    let debtRepo: SqliteDebtRepository;
    let customerRepo: SqliteCustomerRepository;
    let cocheraRepo: SqliteCocheraRepository;
    let vehicleRepo: SqliteVehicleRepository;
    let db: any;

    const mockReq = (body: any, headers: any = {}) => ({
        body,
        headers: { 'x-garage-id': '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02', ...headers },
        params: {},
        query: {}
    } as any);

    const mockRes = () => {
        const res: any = {};
        res.status = vi.fn().mockImplementation((code) => {
            res.statusCode = code;
            return res;
        });
        res.json = vi.fn().mockImplementation((data) => {
            res.data = data;
            return res;
        });
        return res;
    };

    beforeEach(async () => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        db = SQLiteManager.initForTest().getDatabase();

        // Seed isolated test vehicle types, tariffs, and prices
        db.prepare(`INSERT OR REPLACE INTO vehicle_types (id, json_data) VALUES (?, ?)`).run(
            'f1000-vt-id',
            JSON.stringify({ id: 'f1000-vt-id', name: 'F1000', garageId: '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02' })
        );
        db.prepare(`INSERT OR REPLACE INTO tariffs (id, json_data) VALUES (?, ?)`).run(
            'fija-t-id',
            JSON.stringify({ id: 'fija-t-id', name: 'Fija abono', garageId: '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02' })
        );
        db.prepare(`INSERT OR REPLACE INTO prices (id, json_data) VALUES (?, ?)`).run(
            'price-std-id',
            JSON.stringify({ id: 'price-std-id', garageId: '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02', vehicleTypeId: 'f1000-vt-id', tariffId: 'fija-t-id', priceList: 'standard', amount: 860000 })
        );
        db.prepare(`INSERT OR REPLACE INTO prices (id, json_data) VALUES (?, ?)`).run(
            'price-elec-id',
            JSON.stringify({ id: 'price-elec-id', garageId: '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02', vehicleTypeId: 'f1000-vt-id', tariffId: 'fija-t-id', priceList: 'electronic', amount: 946000 })
        );

        subRepo = new SqliteSubscriptionRepository();
        movementRepo = new SqliteMovementRepository();
        debtRepo = new SqliteDebtRepository();
        customerRepo = new SqliteCustomerRepository();
        cocheraRepo = new SqliteCocheraRepository();
        vehicleRepo = new SqliteVehicleRepository();

        await vehicleRepo.save({ id: 'v-1', plate: 'ATE413C', type: 'F1000' } as any);

        controller = new GarageController(
            cocheraRepo,
            customerRepo,
            vehicleRepo,
            subRepo,
            debtRepo,
            movementRepo
        );
    });

    afterEach(async () => {
        SQLiteManager.resetInstance();
        vi.restoreAllMocks();
    });

    it('Caso 1: Cochera #44 con F1000 y Tarifa Fija resuelve exactamente $860.000 para ADVANCE en Efectivo', async () => {
        const subId = uuidv4();
        const customerId = '28bd783e-dbc5-4599-af1e-4dee66466f14';
        const garageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';
        
        // Subscription active with endDate in current month
        const now = new Date();
        const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        await subRepo.save({
            id: subId,
            garageId: garageId,
            customerId: customerId,
            spotNumber: '44',
            type: 'Fija',
            plate: 'ATE413C',
            active: true,
            endDate: currentMonthEnd,
            price: 860000
        } as any);

        const req = mockReq({
            subId,
            customerId,
            amountToPay: 860000,
            paymentMethod: 'Efectivo',
            renewalMode: 'ADVANCE'
        });
        const res = mockRes();

        await controller.renewSubscription(req, res);

        expect(res.statusCode || 200).toBe(200);
        expect(res.data.isAdvancePayment).toBe(true);
        expect(res.data.totalCapitalCovered).toBe(860000);
        expect(res.data.totalSurchargeCovered).toBe(0);

        // Verify updated subscription coverage (+1 month)
        const updatedSub = await subRepo.findById(subId);
        const nextMonthEnd = new Date(currentMonthEnd);
        nextMonthEnd.setDate(15);
        nextMonthEnd.setMonth(nextMonthEnd.getMonth() + 1);
        const expectedNewEnd = new Date(nextMonthEnd.getFullYear(), nextMonthEnd.getMonth() + 1, 0, 23, 59, 59, 999);
        expect(new Date(updatedSub.endDate).getMonth()).toBe(expectedNewEnd.getMonth());
    });

    it('Caso 2: ADVANCE con monto incorrecto es rechazado con HTTP 400', async () => {
        const subId = uuidv4();
        const customerId = '28bd783e-dbc5-4599-af1e-4dee66466f14';
        const garageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';
        
        const now = new Date();
        const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        await subRepo.save({
            id: subId,
            garageId: garageId,
            customerId: customerId,
            spotNumber: '44',
            type: 'Fija',
            plate: 'ATE413C',
            active: true,
            endDate: currentMonthEnd,
            price: 860000
        } as any);

        // Enviar $100 cuando la tarifa es $860.000
        const req = mockReq({
            subId,
            customerId,
            amountToPay: 100,
            paymentMethod: 'Efectivo',
            renewalMode: 'ADVANCE'
        });
        const res = mockRes();

        await controller.renewSubscription(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.data.error).toContain('El importe anticipado debe ser el total exacto');
        expect(res.data.error).toContain('Esperado: 860000');
        expect(res.data.error).toContain('Recibido: 100');
    });

    it('Caso 3: ADVANCE para método Transferencia / Electrónico resuelve tarifa electrónica ($946.000)', async () => {
        const subId = uuidv4();
        const customerId = '28bd783e-dbc5-4599-af1e-4dee66466f14';
        const garageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';
        
        const now = new Date();
        const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        await subRepo.save({
            id: subId,
            garageId: garageId,
            customerId: customerId,
            spotNumber: '44',
            type: 'Fija',
            plate: 'ATE413C',
            active: true,
            endDate: currentMonthEnd,
            price: 860000
        } as any);

        // Para Transferencia, la matriz en SQLite tiene 946.000 para F1000 + Fija
        const req = mockReq({
            subId,
            customerId,
            amountToPay: 946000,
            paymentMethod: 'Transferencia',
            renewalMode: 'ADVANCE'
        });
        const res = mockRes();

        await controller.renewSubscription(req, res);

        expect(res.statusCode || 200).toBe(200);
        expect(res.data.isAdvancePayment).toBe(true);
        expect(res.data.totalCapitalCovered).toBe(946000);
        expect(res.data.totalSurchargeCovered).toBe(0);
    });

    it('Caso 4: Si no existe precio ni en matriz ni en cochera ni en sub, rechaza con HTTP 400 explicito', async () => {
        const subId = uuidv4();
        const customerId = 'client-sin-precio';
        const garageId = 'garage-inexistente';
        
        const now = new Date();
        const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        await subRepo.save({
            id: subId,
            garageId: garageId,
            customerId: customerId,
            type: 'TIPO_DESCONOCIDO',
            active: true,
            endDate: currentMonthEnd
        } as any);

        const req = mockReq({
            subId,
            customerId,
            amountToPay: 50000,
            renewalMode: 'ADVANCE'
        }, { 'x-garage-id': garageId });
        const res = mockRes();

        await controller.renewSubscription(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.data.error).toContain('No se pudo determinar una tarifa válida para este abono');
    });
});
