import { expect, test, describe, beforeAll, afterAll, vi } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { GarageController } from '../src/modules/Garage/infra/GarageController';
import { CustomerRepository } from '../src/modules/Garage/infra/CustomerRepository';
import { VehicleRepository } from '../src/modules/Garage/infra/VehicleRepository';
import { CocheraRepository } from '../src/modules/Garage/infra/CocheraRepository';
import { SubscriptionRepository } from '../src/modules/Garage/infra/SubscriptionRepository';
import { DebtRepository } from '../src/modules/Garage/infra/DebtRepository';
import { MovementRepository } from '../src/modules/Billing/infra/MovementRepository';
import { Request, Response } from 'express';
import { db } from '../src/infrastructure/database/datastore';

vi.mock('../src/infrastructure/database/StorageEngine', () => ({
    StorageEngine: {
        getEngine: vi.fn().mockReturnValue('SQLITE')
    }
}));

vi.mock('../src/modules/Configuration/infra/ConfigRepository', () => {
    return {
        ConfigRepository: class {
            async getPrices() { return [{ vehicleTypeId: 'v1', tariffId: 't1', amount: 1000 }, { vehicleTypeId: 'v1', tariffId: 't2', amount: 800 }, { vehicleTypeId: 'v2', tariffId: 't1', amount: 1500 }]; }
            async getVehicleTypes() { return [{ id: 'v1', name: 'Automovil' }, { id: 'v2', name: 'Camioneta' }]; }
            async getTariffs() { return [{ id: 't1', name: 'Fija' }, { id: 't2', name: 'Movil' }]; }
            async getParams() { return { subscription_full_price_enabled: true }; }
        }
    };
});

describe('Customer Detail Lifecycle / Atomic Fixes', () => {
    let controller: GarageController;
    let customerRepo: CustomerRepository;
    let vehicleRepo: VehicleRepository;
    let cocheraRepo: CocheraRepository;
    let subRepo: SubscriptionRepository;
    let debtRepo: DebtRepository;
    let movementRepo: MovementRepository;

    let testGarageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';
    let customerId: string;
    let cocheraA: string;
    let cocheraB: string;

    beforeAll(async () => {
        process.env.STORAGE_ENGINE = 'SQLITE';

        SQLiteManager.getInstance().getDatabase();

        customerRepo = new CustomerRepository();
        vehicleRepo = new VehicleRepository();
        cocheraRepo = new CocheraRepository();
        subRepo = new SubscriptionRepository();
        debtRepo = new DebtRepository();
        movementRepo = new MovementRepository();

        controller = new GarageController(cocheraRepo, customerRepo, vehicleRepo, subRepo, debtRepo, movementRepo);

        db.garages.findOne = vi.fn().mockResolvedValue({ id: testGarageId, owner_id: 'test-owner' });
    });

    afterAll(async () => {
    });

    const createMockReqRes = (body: any, headers = {}) => {
        const req = {
            body: { ...body, paymentMethod: body.paymentMethod || 'Efectivo' },
            params: { id: body.cocheraId },
            headers: { 'x-garage-id': testGarageId, ...headers },
            query: {}
        } as unknown as Request;
        const res = {
            status: function(s: number) { this.statusCode = s; return this; },
            json: function(d: any) { this.data = d; return this; },
            send: function(d: any) { this.data = d; return this; }
        } as unknown as Response & { statusCode?: number, data?: any };
        return { req, res };
    };

    test('T1: Nueva Cochera con cliente nuevo - debe crear todo correctamente', async () => {
        const { req, res } = createMockReqRes({
            customerData: { dni: '12345678', name: 'Test Client' },
            vehicleData: { plate: 'AAA111', type: 'Automovil' },
            subscriptionType: 'Fija',
            spotNumber: 'A1',
            basePrice: 1000,
            amount: 1000,
            montoAbonado: 1000
        });

        await controller.createSubscription(req, res);
        
        if ((res as any).statusCode !== 200) {
            console.error('T1 Failed:', (res as any).data);
        }
        expect((res as any).statusCode || 200).toBe(200);
        
        const customers = await customerRepo.findAll();
        expect(customers.length).toBe(1);
        customerId = customers[0].id;
        
        const subs = await subRepo.findAll();
        expect(subs.length).toBe(1);
        
        const cocheras = await cocheraRepo.findAll();
        expect(cocheras.length).toBe(1);
        cocheraA = cocheras[0].id;
    });

    test('T2/T4/T5: Add Vehicle Atomic - Debe crear un vehículo y actualizar cochera transaccionalmente', async () => {
        const { req, res } = createMockReqRes({
            vehicleData: { plate: 'BBB222', type: 'Camioneta', brand: 'Ford' },
            paymentMethod: 'Efectivo'
        });
        req.params.id = cocheraA;

        await controller.addVehicleAtomic(req, res);

        expect((res as any).statusCode || 200).toBe(200);

        const vehicles = await vehicleRepo.findByCustomerId(customerId);
        expect(vehicles.length).toBe(2);
        
        const vehB = await vehicleRepo.findByPlate('BBB222');
        expect(vehB?.customerId).toBe(customerId);
        expect(vehB?.isSubscriber).toBe(true);

        const cochera = await cocheraRepo.findById(cocheraA);
        expect(cochera?.vehiculos).toContain('BBB222');
        expect(cochera?.vehiculos).toContain('AAA111');
        
        // Check if movement upgrade happened (assuming Camioneta is more expensive than Automovil in mock logic? We don't have real PricingEngine here so price might not change, but atomicity holds).
    });

    test('T10: Unassign Vehicle - debe desvincular sin borrar historial', async () => {
        const { req, res } = createMockReqRes({
            cocheraId: cocheraA,
            plate: 'BBB222'
        });

        await controller.unassignVehicle(req, res);
        expect((res as any).statusCode || 200).toBe(200);

        const cochera = await cocheraRepo.findById(cocheraA);
        expect(cochera?.vehiculos).not.toContain('BBB222');
        expect(cochera?.vehiculos).toContain('AAA111');
        
        const vehB = await vehicleRepo.findByPlate('BBB222');
        expect(vehB?.isSubscriber).toBe(false);
        expect(vehB?.customerId).toBe(customerId); // P1 BUG FIXED: Customer history preserved!
    });

    test('T12/T17: Release Cochera y Aislamiento 2 Cocheras', async () => {
        // Create second cochera
        const { req: req2, res: res2 } = createMockReqRes({
            customerData: { dni: '12345678', name: 'Test Client' }, // Dedupe will hit T1
            vehicleData: { plate: 'CCC333', type: 'Automovil' },
            subscriptionType: 'Movil',
            basePrice: 500,
            amount: 500
        });
        await controller.createSubscription(req2, res2);

        const cocheras = await cocheraRepo.findAll();
        expect(cocheras.length).toBe(2);
        
        const subs = await subRepo.findAll();
        expect(subs.length).toBe(2);
        
        cocheraB = cocheras.find(c => c.tipo === 'Movil')?.id || '';
        const cocheraAModel = cocheras.find(c => c.tipo === 'Fija');

        // Now release Cochera A
        const { req: reqRelease, res: resRelease } = createMockReqRes({
            cocheraId: cocheraA
        });
        await controller.releaseCochera(reqRelease, resRelease);

        const releasedCochera = await cocheraRepo.findById(cocheraA);
        expect(releasedCochera?.status).toBe('Disponible');
        expect(releasedCochera?.clienteId).toBeNull();
        
        // P0 BUG FIXED: Only Subscription A should be inactive!
        const subList = await subRepo.findAll();
        const subA = subList.find(s => s.type === 'Fija');
        const subB = subList.find(s => s.type === 'Movil');
        
        expect(subA?.active).toBe(false); // Released
        expect(subB?.active).toBe(true);  // UNTOUCHED!
    });

    test('T41/T42/T43: Create Fixed and Mobile with cocheraId exact', async () => {
        // T41: Create Fixed
        const { req: reqF, res: resF } = createMockReqRes({
            customerData: { dni: '999111', name: 'Gap Client' },
            vehicleData: { plate: 'GAP111', type: 'Automovil' },
            subscriptionType: 'Fija',
            spotNumber: 'A1',
            basePrice: 1000
        });
        await controller.createSubscription(reqF, resF);
        if ((resF as any).statusCode !== 200) console.error("T41 Failed", (resF as any).data);
        expect((resF as any).statusCode || 200).toBe(200);

        // T42: Create Mobile 1
        const { req: reqM1, res: resM1 } = createMockReqRes({
            customerData: { dni: '999111', name: 'Gap Client' },
            vehicleData: { plate: 'GAP222', type: 'Automovil' },
            subscriptionType: 'Movil',
            basePrice: 800
        });
        await controller.createSubscription(reqM1, resM1);
        if ((resM1 as any).statusCode !== 200) console.error("T42 Failed", (resM1 as any).data);
        expect((resM1 as any).statusCode || 200).toBe(200);

        // T43: Create Mobile 2
        const { req: reqM2, res: resM2 } = createMockReqRes({
            customerData: { dni: '999111', name: 'Gap Client' },
            vehicleData: { plate: 'GAP333', type: 'Automovil' },
            subscriptionType: 'Movil',
            basePrice: 800
        });
        await controller.createSubscription(reqM2, resM2);
        if ((resM2 as any).statusCode !== 200) console.error("T43 Failed", (resM2 as any).data);
        expect((resM2 as any).statusCode || 200).toBe(200);

        const subs = await subRepo.findAll();
        const gapSubs = subs.filter(s => s.customerId === (subs.find(x => (x as any).plate === 'GAP111')?.customerId));
        
        expect(gapSubs.length).toBe(3);
        
        for (const sub of gapSubs) {
            expect((sub as any).cocheraId).toBeDefined();
            expect((sub as any).cocheraId).not.toBeNull();
        }

        const cocheraIds = gapSubs.map(s => (s as any).cocheraId);
        const uniqueCocheraIds = new Set(cocheraIds);
        expect(uniqueCocheraIds.size).toBe(3); // T43: Distinct cocheraIds
    });

    test('T49/T50: Last vehicle closes exact Subscription', async () => {
        // Release GAP222
        const cocheras = await cocheraRepo.findAll();
        const cochera222 = cocheras.find(c => c.vehiculos?.includes('GAP222'));
        
        const { req, res } = createMockReqRes({
            cocheraId: cochera222?.id,
            plate: 'GAP222'
        });
        await controller.unassignVehicle(req, res);

        const releasedCochera = await cocheraRepo.findById(cochera222?.id || '');
        expect(releasedCochera?.status).toBe('Disponible');

        const subs = await subRepo.findAll();
        const exactSub = subs.find(s => (s as any).cocheraId === cochera222?.id);
        expect(exactSub?.active).toBe(false); // T50: Last vehicle closed exactly this subscription

        // T46: Unlink A does not touch B
        const otherSub = subs.find(s => (s as any).plate === 'GAP333');
        expect(otherSub?.active).toBe(true);
    });
});
