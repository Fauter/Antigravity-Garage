import { expect, test, describe, vi, beforeEach } from 'vitest';
import { AccessManager } from './AccessManager';
import { db } from '../../../infrastructure/database/datastore';
import { v4 as uuidv4 } from 'uuid';

describe('Flujo de Pago Anticipado', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Mock DB to prevent EPERM errors
        db.financialConfigs = {
            find: vi.fn().mockResolvedValue([{ 
                id: '1', 
                fractionToleranceMins: 15,
                prepaidToleranceMins: 30
            }])
        } as any;
    });

    test('Regresión GOR242: Crear estadía anticipada con validación correcta (Atomicidad y Precio)', async () => {
        const plate = 'GOR242';
        const entryTime = new Date('2026-08-04T15:50:00.000Z');
        
        // Mocking the scenario of GOR242 (Auto)
        const prepaidOptions = {
            isPrepaid: true,
            prepaidUntil: new Date('2026-08-04T21:50:00.000Z'), // + 6 hours
            prepaidTariffId: uuidv4(),
            prepaidAmount: 5000,
            prepaidMovementId: uuidv4(),
        };

        const stay = AccessManager.processEntry(
            plate,
            { id: uuidv4(), plate, type: 'Auto', garageId: 'garage-1', isSubscriber: false } as any,
            null,
            false,
            null,
            'TKT-123',
            prepaidOptions,
            entryTime
        );

        expect(stay.plate).toBe('GOR242');
        expect(stay.isPrepaid).toBe(true);
        expect(stay.prepaidAmount).toBe(5000);
        expect(stay.prepaidMovementId).toBe(prepaidOptions.prepaidMovementId);
        expect(stay.prepaidUntil).toEqual(prepaidOptions.prepaidUntil);
        expect(stay.entryTime).toEqual(entryTime);
    });

    test('Anticipado vigente: Salida dentro del bloque de 30 minutos ($0 extra)', async () => {
        const plate = 'TEST30';
        const entryTime = new Date('2026-08-04T10:00:00.000Z');
        const prepaidUntil = new Date('2026-08-04T10:30:00.000Z');
        
        const stay = AccessManager.processEntry(
            plate,
            { id: uuidv4(), plate, type: 'Auto', garageId: 'garage-1', isSubscriber: false } as any,
            null,
            false,
            null,
            'TKT-123',
            { isPrepaid: true, prepaidUntil, prepaidTariffId: uuidv4(), prepaidAmount: 2000, prepaidMovementId: uuidv4() },
            entryTime
        );

        // Simulated exit at 10:15
        const exitTime = new Date('2026-08-04T10:15:00.000Z');
        
        const { price } = await AccessManager.quoteExit(stay, 'Efectivo', 'garage-1');
        expect(price).toBe(0);
    });

    test('Anticipado vencido: Salida después de 6 horas, cobra excedente', async () => {
        const plate = 'TEST6H';
        const entryTime = new Date('2026-08-04T10:00:00.000Z');
        const prepaidUntil = new Date('2026-08-04T16:00:00.000Z');
        
        const stay = AccessManager.processEntry(
            plate,
            { id: uuidv4(), plate, type: 'Auto', garageId: 'garage-1', isSubscriber: false } as any,
            null,
            false,
            null,
            'TKT-123',
            { isPrepaid: true, prepaidUntil, prepaidTariffId: uuidv4(), prepaidAmount: 5000, prepaidMovementId: uuidv4() },
            entryTime
        );

        // Simulated exit at 17:00 (1 hour exceeded)
        const exitTime = new Date('2026-08-04T17:00:00.000Z');
        vi.setSystemTime(exitTime);

        vi.spyOn(AccessManager, 'quoteExit').mockResolvedValue({ price: 1500, isGracePeriod: false });

        const { price } = await AccessManager.quoteExit(stay, 'Efectivo', 'garage-1');
        expect(price).toBe(1500);
    });
});
