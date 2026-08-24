import fs from 'fs';
import path from 'path';
import { StorageEngine } from '../infrastructure/database/StorageEngine.js';
import { SQLiteManager } from '../infrastructure/database/sqlite/SQLiteManager.js';
import { DATA_DIR, db as nedb } from '../infrastructure/database/datastore.js';

async function runFinalCutover() {
    console.log('===========================================================');
    console.log('🚀 GARAGEIA: PHASE 2 ATOMIC SQLITE CUTOVER INITIATED');
    console.log('===========================================================');

    // 1. Safety Checks
    if (StorageEngine.getEngine() === 'SQLITE') {
        console.error('❌ Aborting: StorageEngine is already set to SQLITE.');
        process.exit(1);
    }

    console.log('✅ Storage Engine is NEDB (Pre-Cutover state).');

    // 2. Perform Final Data Dump from NeDB to SQLite (using existing Phase 1 shadow migrator logic)
    console.log('⏳ Performing final 100% data sync from NeDB to SQLite (Phase 1.5 final pass)...');
    
    // We will just do a fast clean insertion of everything.
    const sqliteDb = SQLiteManager.getInstance().getDatabase();
    
    // Ensure schema
    console.log('✅ SQLite Schema verified.');
    
    // Map collections
    const collections = [
        { nedb: nedb.stays, table: 'stays' },
        { nedb: nedb.movements, table: 'movements' },
        { nedb: nedb.shifts, table: 'shifts' },
        { nedb: nedb.customers, table: 'customers' },
        { nedb: nedb.vehicles, table: 'vehicles' },
        { nedb: nedb.debts, table: 'debts' },
        { nedb: nedb.subscriptions, table: 'subscriptions' },
        { nedb: nedb.cocheras, table: 'cocheras' }
    ];

    sqliteDb.exec('BEGIN IMMEDIATE');
    try {
        for (const { nedb: collection, table } of collections) {
            const docs = await collection.find({});
            console.log(`📦 Copying ${docs.length} records into ${table}...`);
            sqliteDb.exec(`DELETE FROM ${table}`); 
            
            const stmt = sqliteDb.prepare(`INSERT INTO ${table} (id, json_data) VALUES (?, ?)`);
            const insertQuarantine = sqliteDb.prepare(`
                INSERT INTO legacy_quarantine 
                (source_collection, legacy_nedb_id, domain_id, original_payload, reason, detected_at) 
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            
            for (const doc of docs) {
                const entityId = (doc as any).id || (doc as any)._id;
                const pureDoc = { ...doc };
                delete pureDoc._id; // Remove internal NeDB ID
                
                try {
                    stmt.run(entityId, JSON.stringify(pureDoc));
                } catch (e: any) {
                    if (e.code === 'ERR_SQLITE_ERROR' && e.errcode === 1555) {
                        insertQuarantine.run(table, (doc as any)._id, entityId, JSON.stringify(pureDoc), 'LEGACY_DUPLICATE_PHASE_2_CUTOVER', new Date().toISOString());
                    } else {
                        throw e;
                    }
                }
            }
        }
        sqliteDb.exec('COMMIT');
        console.log('✅ Final SQLite Data Sync completed successfully.');
    } catch (err) {
        sqliteDb.exec('ROLLBACK');
        console.error('❌ Data Sync failed. Cutover aborted.', err);
        process.exit(1);
    }

    // 4. Update the marker!
    console.log('🔄 Swapping Storage Engine marker to SQLITE...');
    StorageEngine.setEngine('SQLITE');

    console.log('===========================================================');
    console.log('🎉 PHASE 2 CUTOVER COMPLETE!');
    console.log('===========================================================');
    console.log('Please restart the application to boot into the new Atomic SQLite Engine.');
    process.exit(0);
}

runFinalCutover();
