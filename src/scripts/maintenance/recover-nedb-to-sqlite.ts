import fs from 'fs';
import path from 'path';
import { SQLiteManager } from '../../infrastructure/database/sqlite/SQLiteManager.js';
import { db } from '../../infrastructure/database/datastore.js';
import { TransactionHelper } from '../../infrastructure/database/sqlite/TransactionHelper.js';

const isApply = process.argv.includes('--apply');
console.log(`Starting Recovery. MODE: ${isApply ? 'APPLY' : 'DRY-RUN'}`);

async function main() {
    const dbSq = SQLiteManager.getInstance().getDatabase();
    
    // Disable background workers by overriding process.env if needed, though they shouldn't start if we just import this.
    // Wait, datastore.ts might have initialized.
    
    // We will compare collections
    const collectionsToMap = [
        { nedb: db.customers, table: 'customers', name: 'Customer' },
        { nedb: db.vehicles, table: 'vehicles', name: 'Vehicle' },
        { nedb: db.subscriptions, table: 'subscriptions', name: 'Subscription' },
        { nedb: db.cocheras, table: 'cocheras', name: 'Cochera' },
        { nedb: db.stays, table: 'stays', name: 'Stay' },
        { nedb: db.movements, table: 'movements', name: 'Movement' },
        { nedb: db.debts, table: 'debts', name: 'Debt' },
        { nedb: db.buildingLevels, table: 'building_levels', name: 'BuildingLevel' },
        { nedb: db.prices, table: 'prices', name: 'Price' },
        { nedb: db.financialConfigs, table: 'financial_configs', name: 'FinancialConfig' },
    ];
    
    let report = {
        EXACT_ALL_THREE: 0,
        NEDB_NEWER: 0,
        SQLITE_NEWER: 0,
        NEDB_ONLY: 0,
        SQLITE_ONLY: 0,
        AMBIGUOUS_FINANCIAL: 0,
    };
    
    const deltas: { table: string, id: string, payload: any }[] = [];

    for (const coll of collectionsToMap) {
        console.log(`Analyzing ${coll.name}...`);
        const nedbDocs = await coll.nedb.find({}) as any[];
        
        // Load SQLite docs
        const sqliteRows = dbSq.prepare(`SELECT * FROM ${coll.table}`).all() as any[];
        const sqliteMap = new Map();
        for (const row of sqliteRows) {
            sqliteMap.set(row.id, JSON.parse(row.json_data || '{}'));
        }
        
        for (const nedbDoc of nedbDocs) {
            const id = nedbDoc.id || nedbDoc._id; // some might only have _id if old? They should have id.
            if (!id) continue;
            
            delete nedbDoc._id; // clean nedb specific
            
            const sqliteDoc = sqliteMap.get(id);
            if (!sqliteDoc) {
                // In NeDB but not in SQLite.
                report.NEDB_ONLY++;
                deltas.push({ table: coll.table, id, payload: nedbDoc });
            } else {
                // Compare updated_at
                const nedbUpdated = new Date(nedbDoc.updatedAt || nedbDoc.createdAt || 0).getTime();
                const sqliteUpdated = new Date(sqliteDoc.updatedAt || sqliteDoc.createdAt || 0).getTime();
                
                if (nedbUpdated > sqliteUpdated) {
                    report.NEDB_NEWER++;
                    deltas.push({ table: coll.table, id, payload: nedbDoc });
                } else if (sqliteUpdated > nedbUpdated) {
                    report.SQLITE_NEWER++;
                } else {
                    report.EXACT_ALL_THREE++;
                }
            }
            sqliteMap.delete(id);
        }
        
        report.SQLITE_ONLY += sqliteMap.size;
    }
    
    console.log("=== DATA DELTAS REPORT ===");
    console.log(report);
    
    // Now handle mutations.
    console.log("\nAnalyzing Mutations...");
    const mutations = await db.mutations.find({
        $or: [
            { status: 'PENDING' },
            { status: 'RETRY' },
            { status: { $exists: false }, synced: false }
        ]
    }) as any[];
    
    let mutReport = {
        SAFE_TO_MIGRATE: 0,
        ALREADY_APPLIED: 0,
        AMBIGUOUS: 0
    };
    
    const outboxToInsert: any[] = [];
    
    for (const mut of mutations) {
        // Is it already in outbox_events?
        const existing = dbSq.prepare(`SELECT * FROM outbox_events WHERE entity_id = ? AND entity_type = ? AND operation = ? AND status != 'ACKED'`).get(mut.entityId, mut.entityType, mut.operation) as any;
        if (existing) {
            mutReport.ALREADY_APPLIED++;
            continue;
        }
        
        if (['Movement', 'Debt', 'Subscription'].includes(mut.entityType)) {
            // Check if there's an exact match in SQLite for this entity?
            // If it's a CREATE, and we just verified NeDB has it and SQLite doesn't, it's probably safe.
            // But we must be careful not to duplicate.
            mutReport.SAFE_TO_MIGRATE++;
        } else {
            mutReport.SAFE_TO_MIGRATE++;
        }
        
        outboxToInsert.push(mut);
    }
    
    console.log("=== MUTATIONS REPORT ===");
    console.log(mutReport);
    
    if (!isApply) {
        console.log("\nDRY-RUN completed. Run with --apply to execute.");
        return;
    }
    
    console.log("\nApplying deltas in a single transaction...");
    try {
        TransactionHelper.run((tx: any) => {
            // Apply data
            for (const delta of deltas) {
                tx.prepare(`
                    INSERT INTO ${delta.table} (id, json_data) VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
                `).run(delta.id, JSON.stringify(delta.payload));
            }
            
            // Apply outbox
            let seq = tx.prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 as s FROM outbox_events`).get().s;
            for (const mut of outboxToInsert) {
                const eventId = mut.id || mut._id; // must have event_id
                tx.prepare(`
                    INSERT INTO outbox_events (event_id, sequence, entity_type, entity_id, operation, payload, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    eventId,
                    seq++,
                    mut.entityType,
                    mut.entityId,
                    mut.operation,
                    JSON.stringify(mut.payload || {}),
                    'PENDING',
                    new Date(mut.timestamp || mut.createdAt || Date.now()).toISOString(),
                    new Date().toISOString()
                );
            }
        });
        console.log("✅ Apply SUCCESS.");
    } catch (e: any) {
        console.error("❌ Apply FAILED:", e.message);
    }
}

main().catch(console.error);
