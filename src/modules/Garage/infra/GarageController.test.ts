import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GarageController } from './GarageController';

// Mocks
vi.mock('../../../infrastructure/database/datastore.js', async (importOriginal) => {
    return {
        db: {
            vehicleTypes: { find: async () => [{ id: 'vt1', name: 'Auto' }] },
            tariffs: { find: async () => [{ id: 't1', name: 'Fija' }] },
            prices: { find: async () => [{ vehicleTypeId: 'vt1', tariffId: 't1', amount: 16000 }] },
            financialConfigs: { find: vi.fn().mockResolvedValue([]) },
            cocheras: { find: async () => [], findOne: async () => null, insert: async () => {}, getAll: async () => [], create: async () => {}, updateOne: async () => {} },
            clientes: { findOne: async () => null, insert: async () => {}, remove: async () => {} },
            vehiculos: { findOne: async () => null, insert: async () => {}, remove: async () => {} },
            suscripciones: { find: async () => [], insert: async (sub: any) => ({ ...sub, _id: 'sub123' }), remove: async () => {} },
            movimientos: { insert: async () => {} },
            deudas: { insert: async () => {} }
        }
    };
});

vi.mock('./CustomerRepository', () => {
    function MockCustomerRepository() {}
    MockCustomerRepository.prototype.findByDni = async () => null;
    MockCustomerRepository.prototype.save = async () => ({ id: 'cust1' });
    MockCustomerRepository.prototype.db = { delete: async () => {} };
    return { CustomerRepository: MockCustomerRepository };
});

vi.mock('./VehicleRepository', () => {
    function MockVehicleRepository() {}
    MockVehicleRepository.prototype.findByPlate = async () => null;
    MockVehicleRepository.prototype.save = async () => ({ id: 'veh1' });
    MockVehicleRepository.prototype.db = { delete: async () => {} };
    return { VehicleRepository: MockVehicleRepository };
});

vi.mock('./SubscriptionRepository', () => {
    function MockSubscriptionRepository() {}
    MockSubscriptionRepository.prototype.findByCustomerId = async () => [];
    MockSubscriptionRepository.prototype.save = async (sub: any) => ({ ...sub, id: 'sub1' });
    MockSubscriptionRepository.prototype.delete = async () => {};
    return { SubscriptionRepository: MockSubscriptionRepository };
});

vi.mock('../../Billing/infra/MovementRepository', () => {
    function MockMovementRepository() {}
    MockMovementRepository.prototype.save = async () => {};
    return { MovementRepository: MockMovementRepository };
});

vi.mock('./DebtRepository', () => {
    function MockDebtRepository() {}
    MockDebtRepository.prototype.save = async () => {};
    return { DebtRepository: MockDebtRepository };
});

vi.mock('../../Sync/application/QueueService.js', () => {
    function MockQueueService() {}
    MockQueueService.prototype.enqueue = async () => true;
    return { QueueService: MockQueueService };
});

vi.mock('../../../shared/CorrelativeGenerator', () => ({
    CorrelativeGenerator: {
        nextReceiptNumber: vi.fn().mockResolvedValue('REC-001')
    }
}));

import { CorrelativeGenerator } from '../../../shared/CorrelativeGenerator';
import { db } from '../../../infrastructure/database/datastore.js';

describe('GarageController - POST /abonos/alta-completa', () => {
    let controller: GarageController;
    let mockReq: any;
    let mockRes: any;
    
    beforeEach(() => {
        vi.clearAllMocks();
        controller = new GarageController();

        mockReq = {
            headers: { 'x-garage-id': 'garage1' },
            body: {
                customerData: { dni: '123', name: 'Juan' },
                vehicleData: { plate: 'ABC', type: 'Auto' },
                subscriptionType: 'Fija',
                spotNumber: '12',
                piso: '1',
                paymentMethod: 'Efectivo',
                montoAbonado: 16000,
                exonerateLastDays: false
            }
        };

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
    });

    it('Caso Normal con Pago Completo', async () => {
        await controller.createSubscription(mockReq, mockRes);
        expect(mockRes.json).toHaveBeenCalled();
        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData.movementCreated).toBe(true);
        expect(responseData.ticket_code).toBe('REC-001');
        // We can't easily check mockMovementRepo here if it's instanced inside the controller
        // unless we export the mock. But we can trust responseData.movementCreated.
    });

    it('Caso Normal con Pago Parcial', async () => {
        mockReq.body.montoAbonado = 10000;
        await controller.createSubscription(mockReq, mockRes);
        expect(mockRes.json).toHaveBeenCalled();
        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData.movementCreated).toBe(true);
    });

    it('Caso Exonerado en día elegible', async () => {
        // Mock current date to a valid last day of the month
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 31, 12, 0, 0)); // Jan 31

        mockReq.body.exonerateLastDays = true;
        await controller.createSubscription(mockReq, mockRes);
        
        expect(mockRes.json).toHaveBeenCalled();
        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData.exonerated).toBe(true);
        expect(responseData.effectiveInitialAmount).toBe(0);
        expect(responseData.movementCreated).toBe(false);
        expect(CorrelativeGenerator.nextReceiptNumber).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('Caso Exoneración fuera de fecha', async () => {
        // Mock current date to a non-eligible day
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 29, 12, 0, 0)); // Jan 29

        mockReq.body.exonerateLastDays = true;
        await controller.createSubscription(mockReq, mockRes);
        
        expect(mockRes.status).toHaveBeenCalledWith(422);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            error: "La exoneración inicial solamente está disponible durante los últimos dos días del mes."
        }));

        vi.useRealTimers();
    });

    it('Caso Full-Price + Exoneración (Gana Exoneración)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 31, 12, 0, 0));

        (db.financialConfigs.find as any).mockResolvedValueOnce([{
            subscriptionFullPriceEnabled: true,
            subscriptionFullPriceUntilDay: 31,
            updatedAt: new Date()
        }]);

        mockReq.body.exonerateLastDays = true;
        await controller.createSubscription(mockReq, mockRes);
        
        expect(mockRes.json).toHaveBeenCalled();
        const responseData = mockRes.json.mock.calls[0][0];
        
        expect(responseData.exonerated).toBe(true);
        expect(responseData.effectiveInitialAmount).toBe(0);
        expect(responseData.calculatedInitialAmount).toBe(16000); // Because of full price policy!

        vi.useRealTimers();
    });
});
