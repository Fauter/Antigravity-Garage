import { SQLiteManager } from './src/infrastructure/database/sqlite/SQLiteManager.js';
import { CanonicalEntityHelper } from './src/infrastructure/database/sqlite/CanonicalEntityHelper.js';
import { SubscriptionCoverageReconciler } from './src/modules/Billing/application/SubscriptionCoverageReconciler.js';
import { SubscriptionRepository } from './src/modules/Garage/infra/SubscriptionRepository.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const isExecute = process.argv.includes('--execute');
    const isDryRun = !isExecute;
    const garageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';

    console.log(`[INIT] Running in ${isDryRun ? 'DRY RUN' : 'EXECUTE'} mode`);

    const db = SQLiteManager.getInstance().getDatabase();
    const subRepo = new SubscriptionRepository();
    const reconciler = new SubscriptionCoverageReconciler();

    // 1. Load Data
    const allSubsRaw = db.prepare(`SELECT id, json_data FROM subscriptions`).all() as any[];
    const allSubsParsed = allSubsRaw.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
    const allSubs = CanonicalEntityHelper.resolveCanonical<any>(allSubsParsed, 'Subscription');

    const allDebtsRaw = db.prepare(`SELECT id, json_data FROM debts`).all() as any[];
    const allDebtsParsed = allDebtsRaw.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
    const allDebts = CanonicalEntityHelper.resolveCanonical<any>(allDebtsParsed, 'Debt');

    const allMovementsRaw = db.prepare(`SELECT id, json_data FROM movements`).all() as any[];
    const allMovementsParsed = allMovementsRaw.map(r => ({ id: r.id, ...JSON.parse(r.json_data) }));
    const allMovements = CanonicalEntityHelper.resolveCanonical<any>(allMovementsParsed, 'Movement');

    // 2. Identify active subscriptions for the garage
    const activeSubs = allSubs.filter(s => 
        (s.garageId === garageId || s.garage_id === garageId) && s.active === true
    );

    const toUpdate: any[] = [];
    const resultsTable: any[] = [];
    
    let consistent = 0;
    let ambiguous = 0;
    let coverageAhead = 0;
    let skippedCarlenee = false;

    // 3. Process each active subscription
    for (const sub of activeSubs) {
        const currentEndDate = sub.endDate ? new Date(sub.endDate) : new Date(sub.startDate);
        const expectedEndDate = reconciler.reconcileCoverage(sub, garageId, allDebts, allMovements);

        const currentMs = currentEndDate.getTime();
        const expectedMs = expectedEndDate.getTime();

        let classification = 'CONSISTENT';
        let action = 'SKIP';

        if (currentMs === expectedMs) {
            classification = 'CONSISTENT';
            consistent++;
            if (sub.id === '1f14aae7-f3d9-4911-8685-1355a8efeda0') {
                skippedCarlenee = true;
                action = 'SKIP CONSISTENT (Carlenee)';
            }
        } else if (currentMs < expectedMs) {
            classification = 'COVERAGE_BEHIND_PAID_PERIOD';
            action = 'UPDATE';
            toUpdate.push({ sub, expectedEndDate });
        } else if (currentMs > expectedMs) {
            classification = 'COVERAGE_AHEAD_OF_PAID_PERIOD';
            coverageAhead++;
        } else {
            classification = 'AMBIGUOUS';
            ambiguous++;
        }

        // Add to display table
        if (classification === 'COVERAGE_BEHIND_PAID_PERIOD' || sub.id === '1f14aae7-f3d9-4911-8685-1355a8efeda0' || sub.id === 'bed96145-1db9-45f9-929d-4260f4605857') {
            resultsTable.push({
                customer: sub.customerName || sub.customerId || sub.clientId,
                subscriptionId: sub.id,
                currentEndDate: currentEndDate.toISOString(),
                expectedEndDate: expectedEndDate.toISOString(),
                classification,
                action
            });
        }
    }

    console.log('\n========================================');
    console.log('RECONCILIATION PLAN');
    console.log('========================================');
    console.table(resultsTable);

    console.log('\n--- PRE-VALIDATION TOTALS ---');
    console.log(`total active  : ${activeSubs.length}`);
    console.log(`toUpdate      : ${toUpdate.length}`);
    console.log(`consistent    : ${consistent}`);
    console.log(`ambiguous     : ${ambiguous}`);
    console.log(`coverageAhead : ${coverageAhead}`);

    console.log('\n--- ARCHITECTURE INFO ---');
    console.log('Repository to use: SubscriptionRepository.save(sub, tx)');
    console.log('Outbox generation: Handled automatically by BaseSqliteRepository inside save() via generateOutboxEvent & insertOutboxEvent.');
    console.log('Backup Strategy: db.prepare("VACUUM INTO ?").run(backupPath) ensuring atomic snapshot in WAL mode.');

    if (isDryRun) {
        console.log('\n[DRY RUN COMPLETED] No writes were performed.');
        process.exit(0);
    }

    // 4. Execution Guard
    if (activeSubs.length !== 11 || toUpdate.length !== 10 || consistent !== 1 || ambiguous !== 0 || coverageAhead !== 0) {
        console.error('\n[FATAL] Pre-validation failed! Target numbers do not match instructions.');
        process.exitCode = 1;
        return;
    }

    // 5. Backup
    const dataDir = path.resolve('.data');
    const backupPath = path.join(dataDir, `garageia_backup_pre_reconcile_${Date.now()}.sqlite`);
    console.log(`\n[BACKUP] Creating snapshot at ${backupPath}...`);
    try {
        db.prepare('VACUUM INTO ?').run(backupPath);
        console.log('[BACKUP] Successful.');
    } catch (e) {
        console.error('[FATAL] Backup failed. Aborting execution.', e);
        process.exitCode = 1;
        return;
    }

    // 6. Atomic Execution
    console.log('\n[EXECUTION] Beginning immediate transaction...');
    db.exec('BEGIN IMMEDIATE;');
    try {
        for (const item of toUpdate) {
            const { sub, expectedEndDate } = item;
            
            // Only update end dates and timestamps.
            sub.endDate = expectedEndDate.toISOString();
            if (sub.end_date !== undefined) sub.end_date = expectedEndDate.toISOString();
            sub.updatedAt = new Date().toISOString();
            
            await subRepo.save(sub, db); // pass db as tx
        }
        db.exec('COMMIT;');
        console.log(`[EXECUTION] SUCCESS! ${toUpdate.length} subscriptions securely updated with corresponding outbox events.`);
    } catch (err) {
        db.exec('ROLLBACK;');
        console.error('[FATAL] Transaction failed. Rolled back entirely.', err);
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exitCode = 1;
});
