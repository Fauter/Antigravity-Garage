import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GarageController } from '../src/modules/Garage/infra/GarageController';

// Mock dependencies
const mockSubRepo = {
    findById: vi.fn(),
    save: vi.fn()
};
const mockDebtRepo = {
    findBySubscriptionId: vi.fn(),
    findAll: vi.fn().mockResolvedValue([])
};
const mockMovementRepo = {
    save: vi.fn(),
    findAll: vi.fn().mockResolvedValue([])
};

vi.mock('../src/shared/infra/TransactionHelper', () => ({
    TransactionHelper: {
        runAsync: async (cb: any) => {
            const dbMock = {};
            return await cb(dbMock);
        }
    }
}));

vi.mock('../src/shared/CorrelativeService', () => ({
    CorrelativeService: {
        allocateMovementTicketCode: vi.fn().mockResolvedValue('TICKET-123')
    }
}));

vi.mock('../src/modules/Billing/domain/SubscriptionManager', () => ({
    SubscriptionManager: {
        advanceSubscription: vi.fn().mockReturnValue({
            id: 'sub-89',
            active: 1,
            endDate: '2026-11-01T02:59:59.999Z',
            garageId: 'garage-1'
        })
    }
}));

describe('ADVANCE End-to-End Flow', () => {
    let controller: any;
    
    beforeEach(() => {
        vi.clearAllMocks();
        controller = new GarageController(null as any, null as any, null as any, mockSubRepo as any, mockDebtRepo as any, mockMovementRepo as any);
        controller.resolveSubscriptionMonthlyPrice = vi.fn().mockResolvedValue(310000);
    });

    it('FASE 14: END-TO-END DEMOSTRATION of ADVANCE', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-17T15:00:00.000Z'));

        const storedEndDate = '2026-10-01T02:59:59.999Z';
        const subMock = {
            id: 'sub-89',
            active: 1,
            endDate: storedEndDate,
            garageId: 'garage-1',
            plate: 'AEY46S',
            type: 'Fija'
        };

        mockSubRepo.findById.mockResolvedValue(subMock);
        mockDebtRepo.findBySubscriptionId.mockResolvedValue([]);

        const req = {
            body: {
                subId: 'sub-89',
                customerId: 'cust-1',
                amountToPay: 310000,
                paymentMethod: 'Efectivo',
                billingType: 'Final',
                operator: 'Sistema',
                renewalMode: 'ADVANCE',
                spotNumber: '89',
                cocheraType: 'Fija'
            },
            headers: { 'x-garage-id': 'garage-1' }
        };

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        const consoleSpy = vi.spyOn(console, 'log');

        await controller.renewSubscription(req, res as any);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ADVANCE] coveredPeriod=2026-09'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ADVANCE] businessCurrentPeriod=2026-09'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ADVANCE] nextPeriod=2026-10'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ADVANCE] eligible=true'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ADVANCE] ticketAllocated=TICKET-123'));

        const movementSavedCall = mockMovementRepo.save.mock.calls[0][0];
        expect(movementSavedCall.amount).toBe(310000);
        expect(movementSavedCall.type).toBe('CobroAbono');
        expect(movementSavedCall.notes).toContain('Renovación Abono Anticipada - Octubre 2026 - Cochera #89 - Período 2026-10');

        const subSavedCall = mockSubRepo.save.mock.calls[0][0];
        expect(new Date(subSavedCall.endDate).toISOString()).toBe('2026-11-01T02:59:59.999Z');

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ADVANCE] COMMIT'));

        const jsonResponse = res.json.mock.calls[0][0];
        expect(jsonResponse.message).toContain('Pago anticipado exitoso');
        expect(jsonResponse.ticket_code).toBe('TICKET-123');
        expect(jsonResponse.isAdvancePayment).toBe(true);

        // FASE 16: SEGUNDO INTENTO (doble cobro)
        const subMockAdvanced = {
            id: 'sub-89',
            active: 1,
            endDate: '2026-11-01T02:59:59.999Z',
            garageId: 'garage-1'
        };
        mockSubRepo.findById.mockResolvedValue(subMockAdvanced);

        const res2 = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await controller.renewSubscription(req, res2 as any);

        expect(res2.status).toHaveBeenCalledWith(409); // Expected exact HTTP 409
        expect(res2.json.mock.calls[0][0].error).toContain('El próximo período ya se encuentra abonado');

        vi.useRealTimers();
    });
});
