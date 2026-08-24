import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccessController } from '../src/modules/AccessControl/infra/AccessController';
import { db } from '../src/infrastructure/database/datastore';

vi.mock('../src/infrastructure/database/datastore', () => ({
    db: {
        vehicles: {
            find: vi.fn()
        }
    }
}));

describe('AccessController - getAllActiveStays', () => {
    let accessController: any;

    beforeEach(() => {
        accessController = new AccessController();
        vi.clearAllMocks();
    });

    it('10. endpoint sin consultas N+1 y regresión ATQ563 (is_subscriber: false -> true)', async () => {
        // Mock request and response
        const req: any = { query: {}, headers: { 'x-garage-id': '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02' } };
        const res: any = {
            json: vi.fn(),
            status: vi.fn().mockReturnThis()
        };

        const garageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';

        // 1. vehiculo con isSubscriber = true (ATQ563 regression case)
        // 3. discrepancia stay.isSubscriber = false y vehicle.isSubscriber = true
        // 6. abonado y anticipado simultaneamente
        const stay1 = {
            id: 'stay-1',
            vehicleId: '330ad545-c5d8-40fc-97c7-0cfac4be3c27',
            plate: 'ATQ563',
            is_subscriber: false, // Local stay says false
            isPrepaid: true,
            prepaidUntil: new Date().toISOString(),
            active: true
        };

        // 2. vehiculo con isSubscriber = false
        // 8. booleano remoto is_subscriber = false
        const stay2 = {
            id: 'stay-2',
            vehicleId: 'vehicle-2',
            plate: 'BBB111',
            is_subscriber: true, // Stay says true but vehicle is false
            active: true
        };

        // 4. estadia sin vehicleId, resuelta por garage y patente
        const stay3 = {
            id: 'stay-3',
            vehicleId: null,
            plate: 'CCC222',
            active: true
        };

        // 7. vehiculo inexistente
        const stay4 = {
            id: 'stay-4',
            vehicleId: 'vehicle-4',
            plate: 'DDD333',
            active: true
        };

        accessController.stayRepository.findAllActive = vi.fn().mockResolvedValue([stay1, stay2, stay3, stay4]);

        const vehicle1 = {
            id: '330ad545-c5d8-40fc-97c7-0cfac4be3c27',
            plate: 'ATQ563',
            is_subscriber: true, // DB says true
            type: 'Auto',
            garageId
        };
        const vehicle2 = {
            id: 'vehicle-2',
            plate: 'BBB111',
            is_subscriber: false, // DB says false
            type: 'Moto',
            garageId
        };
        // 5. mismo numero de patente en otro garage (deberia ser ignorado si la estadia no tiene vehicleId y busca por garage)
        // Wait, local db returns all matches for query, we expect filter fallback to check garageId
        const vehicle3_otherGarage = {
            id: 'vehicle-3-other',
            plate: 'CCC222',
            is_subscriber: true,
            type: 'Camioneta',
            garageId: 'other-garage-id'
        };
        const vehicle3_thisGarage = {
            id: 'vehicle-3-this',
            plate: 'CCC222',
            is_subscriber: false,
            type: 'Auto',
            garageId: garageId
        };

        // Mock db.vehicles.find to return these in one call (N+1 prevention check)
        (db.vehicles.find as any).mockResolvedValue([vehicle1, vehicle2, vehicle3_otherGarage, vehicle3_thisGarage]);

        await accessController.getAllActiveStays(req, res);

        expect(db.vehicles.find).toHaveBeenCalledTimes(1); // One batch call

        const queryArg = (db.vehicles.find as any).mock.calls[0][0];
        expect(queryArg.$or).toBeDefined();

        const responseData = res.json.mock.calls[0][0];
        
        // 9. serializer camelCase check
        expect(responseData[0]).toHaveProperty('isSubscriber');
        expect(responseData[0]).toHaveProperty('vehicleId');

        const resStay1 = responseData.find((s: any) => s.plate === 'ATQ563');
        const resStay2 = responseData.find((s: any) => s.plate === 'BBB111');
        const resStay3 = responseData.find((s: any) => s.plate === 'CCC222');
        const resStay4 = responseData.find((s: any) => s.plate === 'DDD333');

        // Verify Regression ATQ563
        expect(resStay1.isSubscriber).toBe(true); // Should take from vehicle1
        expect(resStay1.vehicleId).toBe('330ad545-c5d8-40fc-97c7-0cfac4be3c27');
        expect(resStay1.isPrepaid).toBe(true); // abonado y anticipado

        // Verify Stay 2
        expect(resStay2.isSubscriber).toBe(false); // Should take from vehicle2

        // Verify Stay 3 (resolved by plate + garage fallback)
        expect(resStay3.vehicleId).toBe('vehicle-3-this');
        expect(resStay3.isSubscriber).toBe(false);

        // Verify Stay 4 (vehicle nonexistent)
        expect(resStay4.isSubscriber).toBe(false);
    });
});
