import Datastore from 'nedb-promises';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
let DATA_DIR: string;

try {
    const { app } = require('electron');
    if (app) {
        DATA_DIR = path.join(app.getPath('userData'), 'database');
    } else {
        DATA_DIR = path.resolve(process.cwd(), '.data');
    }
} catch (e) {
    DATA_DIR = path.resolve(process.cwd(), '.data');
}

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
} else {
    // 6. Limpieza de Archivos Temporales (.db~) para evitar Database Locks (Zombies)
    try {
        const files = fs.readdirSync(DATA_DIR);
        let cleaned = 0;
        for (const file of files) {
            if (file.endsWith('.db~')) {
                fs.unlinkSync(path.join(DATA_DIR, file));
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`🧹 Local Datastore: Se limpiaron ${cleaned} archivos temporales (.db~) bloqueados.`);
        }
    } catch (err) {
        console.error('❌ Local Datastore: Error limpiando archivos temporales:', err);
    }
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
    garages: createStore('garages'), // Added for Metadata
    cocheras: createStore('cocheras'),
    debts: createStore('debts'),
    shiftCloses: createStore('shift_closes'),
    partialCloses: createStore('partial_closes'),
    incidents: createStore('incidents'),
    promos: createStore('promos'),
    buildingLevels: createStore('building_levels'),

    // Config Stores
    vehicleTypes: createStore('vehicle_types'),
    tariffs: createStore('tariffs'),
    prices: createStore('prices'),
    financialConfigs: createStore('financial_configs'),

    // Sync Queue
    mutations: createStore('mutations'),
    syncConflicts: createStore('sync_conflicts')
};

console.log('📦 Local Datastore (NeDB) Initialized in ./.data/');
