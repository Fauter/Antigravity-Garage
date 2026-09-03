import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import fs from 'fs';

const args = process.argv.slice(2);
const isDryRun = !args.includes('--apply');

console.log(`\n======================================================`);
console.log(`🚀 LOGICAL RECONCILIATION SCRIPT (Mode: ${isDryRun ? 'DRY-RUN' : 'APPLY'})`);
console.log(`======================================================\n`);

const db = SQLiteManager.getInstance().getDatabase();

console.log(`\n--- Analizando consistencia lógica de Debts ---`);
const allDebts = db.prepare(`SELECT id, json_data FROM debts`).all() as any[];
let debtsFixed = 0;
let debtsAmbiguous = 0;

for (const row of allDebts) {
    const debt = JSON.parse(row.json_data);
    let needsUpdate = false;
    let notes = [];
    
    // Normalize fields
    const remaining = debt.remainingAmount !== undefined ? debt.remainingAmount : debt.remaining_amount;
    const paid = debt.amountPaid !== undefined ? debt.amountPaid : debt.amount_paid;

    if (debt.status === 'PAID') {
        if (remaining > 0 || !paid || paid < debt.amount) {
            // Find movement
            const movements = db.prepare(`SELECT * FROM movements WHERE json_extract(json_data, '$.relatedEntityId') = ? OR json_extract(json_data, '$.notes') LIKE ?`).all(debt.subscriptionId || debt.customerId, `%${debt.id.substring(0,8)}%`) as any[];
            const hasPaymentMovement = movements.some(m => {
                const md = JSON.parse(m.json_data);
                return md.notes && md.notes.includes(debt.id.substring(0,8)) && md.type === 'CobroAbono';
            });

            if (hasPaymentMovement) {
                debt.remainingAmount = 0;
                debt.amountPaid = debt.amount;
                needsUpdate = true;
                notes.push(`Fixed PAID debt with remaining=${remaining}. Movement verified.`);
            } else if (remaining === 0) {
                debt.amountPaid = debt.amount;
                needsUpdate = true;
                notes.push(`Fixed PAID debt with amountPaid=${paid} but remaining=0. Assumed full payment.`);
            } else {
                debtsAmbiguous++;
                console.log(`⚠️ AMBIGUOUS: Debt ${debt.id} is PAID but remaining=${remaining} and NO movement found.`);
            }
        }
    } else if (debt.status === 'PENDING') {
        // Find if there is a movement that ACTUALLY paid this
        const movements = db.prepare(`SELECT * FROM movements WHERE json_extract(json_data, '$.relatedEntityId') = ? OR json_extract(json_data, '$.notes') LIKE ?`).all(debt.subscriptionId || debt.customerId, `%${debt.id.substring(0,8)}%`) as any[];
        const hasPaymentMovement = movements.some(m => {
            const md = JSON.parse(m.json_data);
            return md.notes && md.notes.includes(debt.id.substring(0,8)) && md.type === 'CobroAbono';
        });

        if (hasPaymentMovement) {
            debt.status = 'PAID';
            debt.remainingAmount = 0;
            debt.amountPaid = debt.amount;
            needsUpdate = true;
            notes.push(`Upgraded PENDING debt to PAID. Movement verified.`);
        }
    }

    if (needsUpdate) {
        debtsFixed++;
        if (!isDryRun) {
            db.prepare(`UPDATE debts SET json_data = ? WHERE id = ?`).run(JSON.stringify(debt), row.id);
        }
        if (debt.subscriptionId === '0fb4a3f1-5ded-4b88-84ad-e1cc6fb58387') {
            console.log(`✅ Case #75 Debt ${debt.id.substring(0,8)} resolved: ${notes.join(', ')}`);
        }
    }
}

console.log(`\n--- Analizando consistencia lógica de Subscriptions ---`);
const allSubs = db.prepare(`SELECT id, json_data FROM subscriptions`).all() as any[];
let subsFixed = 0;

for (const row of allSubs) {
    const sub = JSON.parse(row.json_data);
    let needsUpdate = false;
    
    if (sub.id === '74fb9033-28e8-4baa-ae1f-2ed512e42434') {
        // Case #44
        const advanceMovement = db.prepare(`SELECT json_data FROM movements WHERE json_extract(json_data, '$.relatedEntityId') = ? AND json_extract(json_data, '$.notes') LIKE '%Anticip%'`).get(sub.id) as any;
        const currentEnd = new Date(sub.endDate || sub.end_date).getTime();
        const octFirst = new Date('2026-11-01T02:59:59.999Z').getTime(); // Nov 1 is coverage for Oct

        if (advanceMovement && currentEnd < octFirst) {
            sub.endDate = '2026-11-01T02:59:59.999+00:00';
            needsUpdate = true;
            console.log(`✅ Case #44 Subscription resolved: advanced endDate to Nov 1 based on movement.`);
        } else if (advanceMovement) {
            console.log(`✅ Case #44 Subscription already correct (EndDate: ${sub.endDate}).`);
        }
    }

    if (needsUpdate) {
        subsFixed++;
        if (!isDryRun) {
            db.prepare(`UPDATE subscriptions SET json_data = ? WHERE id = ?`).run(JSON.stringify(sub), row.id);
        }
    }
}

console.log(`\n======================================================`);
console.log(`📊 SUMMARY REPORT`);
console.log(`======================================================`);
console.log(`Debts Fixed: ${debtsFixed}`);
console.log(`Debts Ambiguous: ${debtsAmbiguous}`);
console.log(`Subscriptions Fixed: ${subsFixed}`);
console.log(`\n${isDryRun ? '✅ DRY-RUN COMPLETED. No data was modified.' : '✅ RECONCILIATION APPLIED SUCCESSFULLY.'}`);
