import { SyncService } from './src/modules/Sync/application/SyncService';
import { GarageController } from './src/modules/Garage/infra/GarageController';

console.log('--- TEST 1: SYNC MAPPING ---');
try {
    const originalCustomer = {
        id: '1234',
        name: 'Carlos Perez',
        dni: '99999999',
        garageId: 'garage-test-id-123',
        ownerId: 'owner-test',
        address: 'Calle Falsa 123',
        localidad: 'CABA',
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const payload = Object.assign({}, originalCustomer);
    // mapLocalToRemote is likely a public method on an instance context or prototype
    const mapFn = SyncService.prototype.mapLocalToRemote || (SyncService as any).mapLocalToRemote;
    if (typeof mapFn === 'function') {
        const fakeInstance = Object.create(SyncService.prototype);
        mapFn.call(fakeInstance, payload, 'Customer');
    } else {
        console.error("Method not found on prototype.");
    }
} catch (e) {
    console.error(e);
}

console.log('--- TEST 2: CONTROLLER MOCK ---');
const MockRepo = {
    findByDni: async () => null,
    save: async (x: any) => x,
    findByPlate: async () => null,
    findById: async () => null,
    findAll: async () => []
};

const controller = new GarageController(
    MockRepo as any,
    MockRepo as any,
    MockRepo as any,
    MockRepo as any,
    MockRepo as any,
    MockRepo as any
);

const req = {
    headers: { 'x-garage-id': 'garage-555' },
    body: {
        customerData: {
            nombreApellido: 'Jules AI',
            dni: '12345678',
            email: 'jules@ai.com',
            telefono: '555-5555'
        },
        vehicleData: { plate: 'AI-000', type: 'Auto', brand: 'TEST', model: 'M' },
        subscriptionType: 'Movil'
    }
};

const res = {
    status: () => res,
    json: () => { }
};

controller.createSubscription(req as any, res as any).catch(console.error);
