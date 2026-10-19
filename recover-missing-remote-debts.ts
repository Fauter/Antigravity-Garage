import { SQLiteManager } from './src/infrastructure/database/sqlite/SQLiteManager.js';
import { supabase } from './src/infrastructure/lib/supabase.js';
import { CanonicalEntityHelper } from './src/infrastructure/database/sqlite/CanonicalEntityHelper.js';
import { DebtSelector } from './src/modules/Billing/domain/DebtSelector.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const isExecute = process.argv.includes('--execute');
    const isDryRun = !isExecute;
    const garageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';

    console.log(`[INIT] Running in ${isDryRun ? 'DRY RUN' : 'EXECUTE'} mode`);

    const db = SQLiteManager.getInstance().getDatabase();

    // 1. CONTRATO DEL OUTBOX (Carlenee)
    const refDebtId = 'bb0d41bd-2346-59a1-ab8e-a9bcdef37e9c';
    const refOutbox = db.prepare(`SELECT * FROM outbox_events WHERE entity_id = ? ORDER BY sequence DESC LIMIT 1`).get(refDebtId) as any;
    if (refOutbox) {
        console.log('\n========================================');
        console.log('1. OUTBOX CONTRACT (Carlenee Ref)');
        console.log(`entity_type: ${refOutbox.entity_type}`);
        console.log(`operation: ${refOutbox.operation}`);
        console.log(`status: ${refOutbox.status}`);
        console.log(`payload sample: ${refOutbox.payload.substring(0, 150)}...`);
        console.log('SqliteSyncCoordinator maps Debt+CREATE to: supabase.from(\'debts\').upsert(payload, { onConflict: \'id\' })');
        console.log('========================================\n');
    }

    // 2. BACKUP
    let backupPath = '';
    if (isExecute) {
        const dataDir = path.resolve('.data');
        backupPath = path.join(dataDir, `garageia_backup_pre_recovery_${Date.now()}.sqlite`);
        console.log(`[BACKUP] Creating safe VACUUM INTO backup at ${backupPath}...`);
        try {
            db.prepare(`VACUUM INTO ?`).run(backupPath);
            console.log('[BACKUP] Backup successful.');
        } catch (e) {
            console.error('[ERROR] Failed to create backup. Aborting.', e);
            process.exitCode = 1;
            return;
        }
    }

    // LOAD LOCAL
    console.log('[AUDIT] Loading local debts for garage...');
    const allDebtsRaw = db.prepare(`SELECT id, json_data FROM debts`).all() as any[];
    const allDebtsParsed = allDebtsRaw.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
    const localDebts = CanonicalEntityHelper.resolveCanonical<any>(allDebtsParsed, 'Debt')
        .filter((d: any) => d.garageId === garageId || d.garage_id === garageId);

    // 4. DUPLICATES & VALIDATION
    const duplicatesMap = new Map<string, string[]>();
    const statusCounts: Record<string, number> = { PAID: 0, PENDING: 0, CANCELLED: 0, OTHER: 0 };
    
    for (const ld of localDebts) {
        // Count Status
        const st = ld.status;
        if (['PAID', 'PENDING', 'CANCELLED'].includes(st)) {
            statusCounts[st]++;
        } else {
            statusCounts['OTHER']++;
        }

        // Logical Dupes Check
        if (ld.type === 'CANON') {
            const bp = DebtSelector.getBillingPeriodKey(ld);
            const subId = ld.subscriptionId || ld.subscription_id;
            const key = `${subId}_${bp}`;
            if (!duplicatesMap.has(key)) duplicatesMap.set(key, []);
            duplicatesMap.get(key)!.push(ld.id);
        }
    }

    const dupes = Array.from(duplicatesMap.entries()).filter(([_, ids]) => ids.length > 1);
    if (dupes.length > 0) {
        console.error('\n[FATAL] Logical duplicates detected locally! Aborting recovery.');
        console.error(dupes);
        process.exitCode = 1;
        return;
    }

    // LOAD REMOTE
    console.log('[AUDIT] Loading remote debts from Supabase...');
    const remoteDebts: any[] = [];
    let page = 0;
    while (true) {
        const { data, error } = await supabase.from('debts').select('id').eq('garage_id', garageId).range(page * 1000, (page + 1) * 1000 - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        remoteDebts.push(...data);
        if (data.length < 1000) break;
        page++;
    }

    const remoteDebtIds = new Set(remoteDebts.map(d => d.id));
    
    // MISSING REMOTE
    const missingRemote = localDebts.filter(ld => !remoteDebtIds.has(ld.id));

    // ACTIVE OUTBOX
    const activeOutboxStatuses = ['PENDING', 'PROCESSING', 'BLOCKED', 'RETRY'];
    let activeOutboxConflicts = 0;
    const toEnqueue = [];

    for (const md of missingRemote) {
        const placeholders = activeOutboxStatuses.map(() => '?').join(',');
        const activeEvents = db.prepare(`SELECT * FROM outbox_events WHERE entity_type = 'Debt' AND entity_id = ? AND status IN (${placeholders})`).all(md.id, ...activeOutboxStatuses) as any[];
        
        if (activeEvents.length > 0) {
            activeOutboxConflicts++;
        } else {
            toEnqueue.push(md);
        }
    }

    console.log('\n========================================');
    console.log('RECOVERY PLAN');
    console.log('========================================');
    console.log(`localCount: ${localDebts.length}`);
    console.log(`logicalDuplicates: ${dupes.length}`);
    console.log(`statusCounts: ${JSON.stringify(statusCounts)}`);
    console.log(`remoteBefore: ${remoteDebts.length}`);
    console.log(`missingRemote: ${missingRemote.length}`);
    console.log(`activeOutboxConflicts: ${activeOutboxConflicts}`);
    console.log(`toEnqueue: ${toEnqueue.length}`);

    if (isDryRun) {
        console.log('\n[DRY RUN] No writes performed.');
        return;
    }

    if (toEnqueue.length === 0) {
        console.log('\n[EXECUTE] Nothing to enqueue. Exiting.');
        return;
    }

    // 5. REVALIDAR SUPABASE JUSTO ANTES
    console.log('\n[EXECUTE] Revalidating remote missing status...');
    const reallyToEnqueue = [];
    for (const d of toEnqueue) {
        const { data } = await supabase.from('debts').select('id').eq('id', d.id).single();
        if (!data) {
            reallyToEnqueue.push(d);
        }
    }
    console.log(`[EXECUTE] After revalidation, still missing: ${reallyToEnqueue.length}`);

    // 7. INSERTS ATÓMICOS
    const insertStmt = db.prepare(`
        INSERT INTO outbox_events 
        (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
        db.exec('BEGIN IMMEDIATE;');
        let insertedCount = 0;
        const now = new Date().toISOString();
        for (const d of reallyToEnqueue) {
            insertStmt.run(uuidv4(), 'Debt', d.id, 'CREATE', JSON.stringify(d), 'PENDING', now, now);
            insertedCount++;
        }
        db.exec('COMMIT;');
        console.log(`\n[EXECUTE] SUCCESS! Atomic transaction committed. Enqueued: ${insertedCount} events.`);
    } catch (err) {
        db.exec('ROLLBACK;');
        console.error('\n[FATAL] Atomic transaction failed! Full rollback executed.', err);
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exitCode = 1;
});
