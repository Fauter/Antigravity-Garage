import { PricingEngine } from '../src/modules/Billing/domain/PricingEngine.js';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { TransactionHelper } from '../src/infrastructure/database/sqlite/TransactionHelper';
import { GarageController } from '../src/modules/Garage/infra/GarageController';
import { SqliteDebtRepository } from '../src/modules/Garage/infra/SqliteDebtRepository';
import { SqliteMovementRepository } from '../src/modules/Billing/infra/SqliteMovementRepository';
import { SqliteSubscriptionRepository } from '../src/modules/Garage/infra/SqliteSubscriptionRepository';
import { SqliteVehicleRepository } from '../src/modules/Garage/infra/SqliteVehicleRepository';
import { SqliteCustomerRepository } from '../src/modules/Garage/infra/SqliteCustomerRepository';
import { SqliteCocheraRepository } from '../src/modules/Garage/infra/SqliteCocheraRepository';
import { v4 as uuidv4 } from 'uuid';

describe('Real Renewal Domain Tests (DEBT and ADVANCE)', () => {
    let controller: GarageController;
    let debtRepo: SqliteDebtRepository;
    let movementRepo: SqliteMovementRepository;
    let subRepo: SqliteSubscriptionRepository;
    let customerRepo: SqliteCustomerRepository;
    let db: any;
    
    beforeEach(() => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        db = SQLiteManager.initForTest().getDatabase();
        
        debtRepo = new SqliteDebtRepository();
        movementRepo = new SqliteMovementRepository();
        subRepo = new SqliteSubscriptionRepository();
        customerRepo = new SqliteCustomerRepository();
        
        controller = new GarageController(
            new SqliteCocheraRepository(),
            customerRepo,
            new SqliteVehicleRepository(),
            subRepo,
            debtRepo,
            movementRepo
        );
    });

    afterEach(() => {
        SQLiteManager.resetInstance();
    });

    const mockReq = (body: any) => ({
        body,
        params: {},
        query: {},
        headers: { 'x-garage-id': 'test-garage' }
    } as any);

    const mockRes = () => {
        const res: any = {};
        res.status = (code: number) => { res.statusCode = code; return res; };
        res.json = (data: any) => { res.data = data; return res; };
        return res;
    };

    it('Fallo 1: Rollback si Movement falla durante DEBT', async () => {
        // Setup mock data
        const subId = uuidv4();
        await subRepo.save({ id: subId, active: true, endDate: new Date('2026-08-31T23:59:59Z') } as any);
        await debtRepo.save({ id: uuidv4(), subscriptionId: subId, customerId: 'customer-1', amount: 460000, garageId: 'test-garage', status: 'PENDING', type: 'CANON', dueDate: new Date() } as any);
        
        // Simular que Movement lanza error interceptando save()
        const moveSpy = vi.spyOn((controller as any).movementRepo, 'save').mockRejectedValue(new Error("Disk Full"));
        
        console.log('TEST 3 DEBTS:', await debtRepo.findByCustomerId('customer-1'));
        const req = mockReq({
            subId,
            customerId: 'customer-1',
            amountToPay: 460000,
            renewalMode: 'DEBT'
        });
        const res = mockRes();
        
        await controller.renewSubscription(req, res);
        
        
        console.log('TEST 1 RES:', res);
        expect(res.data.error).toContain('Disk Full');
        
        // Rollback check
        const debts = await debtRepo.findBySubscriptionId(subId);
        expect(debts[0].status).toBe('PENDING'); // No se marc como PAID
        
        moveSpy.mockRestore();
    });

    it('Fallo 2: Rollback si Subscription falla durante ADVANCE', async () => {
        const subId = uuidv4();
        const nowForTest = new Date();
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 10);
        await subRepo.save({ id: subId, active: true, endDate: futureDate, type: 'AUTO_24H', price: 60000 } as any);
        
        const subSpy = vi.spyOn((controller as any).subscriptionRepo, 'save').mockRejectedValue(new Error("Sub Error"));
        
        const req = mockReq({
            subId,
            amountToPay: 60000, // asumiendo tarifa
            renewalMode: 'ADVANCE'
        });
        const res = mockRes();
        
        await controller.renewSubscription(req, res);
        
        
        console.log('TEST 2 RES:', res);
        expect(res.data.error).toContain('Sub Error');
        
        // Rollback check: no movements inserted
        const movements = await movementRepo.findAll();
        expect(movements.length).toBe(0);
        
        subSpy.mockRestore();
        vi.restoreAllMocks();
    });

    it('TEST REAL DE DEBT RENEWAL: Debe pagar deuda y renovar correctamente', async () => {
        const subId = uuidv4();
        await subRepo.save({ id: subId, active: true, endDate: new Date('2026-08-31T23:59:59Z'), type: 'AUTO_24H' } as any);
        const customerId = 'customer-1';
        const debtId = uuidv4();
        await debtRepo.save({ id: debtId, subscriptionId: subId, customerId: 'customer-1', garageId: 'test-garage', amount: 460000, status: 'PENDING', type: 'CANON', dueDate: new Date() } as any);
        
        console.log('TEST 3 DEBTS:', await debtRepo.findByCustomerId('customer-1'));
        const req = mockReq({
            subId,
            customerId: 'customer-1',
            amountToPay: 460000,
            renewalMode: 'DEBT'
        });
        const res = mockRes();
        
        await controller.renewSubscription(req, res);
        
        expect(res.data).toBeDefined();
        console.log('TEST 3 RES:', res);
        expect(res.data.message).toContain('renovado');
        
        const debts = await debtRepo.findBySubscriptionId(subId);
        expect(debts[0].status).toBe('PAID');
        
        const movements = await movementRepo.findAll();
        expect(movements.length).toBe(1);
        vi.restoreAllMocks();
        expect(movements[0].amount).toBe(460000);
        
        const sub = await subRepo.findById(subId);
        expect(new Date(sub.endDate).getTime()).toBeGreaterThan(new Date('2026-08-31').getTime());
    });
    
    it('TEST REAL DE ADVANCE CONCURRENT: Concurrencia real con Promise.all rechaza el segundo cobro', async () => {
        const subId = uuidv4();
        const nowForTest = new Date();
        const futureDate = new Date();
        futureDate.setDate(nowForTest.getDate() + 1); // Not expired
        
        await subRepo.save({ id: subId, active: true, endDate: futureDate, type: 'AUTO_24H', price: 60000 } as any);
        
        const expectedAmount = 60000;
        
        const reqA = mockReq({ subId, amountToPay: expectedAmount, renewalMode: 'ADVANCE' });
        const resA = mockRes();
        
        const reqB = mockReq({ subId, amountToPay: expectedAmount, renewalMode: 'ADVANCE' });
        const resB = mockRes();
        
        // Simular precio base en el mock request ya que el PricingEngine quizas devuelva 60k
        
        // Node:sqlite driver en sqlite-sync es bloqueante o maneja db.exec. 
        // Llama a ambos a la vez (simulate event loop overlap)
        const results = await Promise.all([
            controller.renewSubscription(reqA, resA).then(() => resA),
            controller.renewSubscription(reqB, resB).then(() => resB)
        ]);
        
        // Uno debera tener success (200), otro debera rebotar con 409 o 500 BUSY
        const codes = results.map(r => r.statusCode || 200);
        
        // Verificar que SLO se insert UN movement
        const movements = await movementRepo.findAll();
        expect(movements.length).toBe(1);
vi.restoreAllMocks();
    });
});
