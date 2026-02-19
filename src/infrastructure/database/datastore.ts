import Datastore from 'nedb-promises';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const DATA_DIR = path.resolve(process.cwd(), '.data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const createStore = (name: string) => {
    return Datastore.create({
        filename: path.join(DATA_DIR, `${name}.db`),
        autoload: true,
        timestampData: true
    });
};

export const db = {
    vehicles: createStore('vehicles'),
    customers: createStore('customers'),
    subscriptions: createStore('subscriptions'),
    movements: createStore('movements'),
    shifts: createStore('shifts'),
    stays: createStore('stays'),
    employees: createStore('employees'),

    // Config Stores
    vehicleTypes: createStore('vehicle_types'),
    tariffs: createStore('tariffs'),
    prices: createStore('prices'),

    // Sync Queue
    mutations: createStore('mutations'),
    syncConflicts: createStore('sync_conflicts')
};

console.log('📦 Local Datastore (NeDB) Initialized in ./.data/');
