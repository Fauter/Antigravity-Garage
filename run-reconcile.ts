import { SQLiteManager } from './src/infrastructure/database/sqlite/SQLiteManager';
import { CorrelativeService } from './src/shared/CorrelativeService';
import path from 'path';

async function run() {
    process.env.DATA_DIR = path.resolve('.data');
    const db = SQLiteManager.getInstance();
    await CorrelativeService.reconcileForGarage('1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02');
    console.log('Done');
}
run();
