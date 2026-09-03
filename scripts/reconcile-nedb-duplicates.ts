import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import fs from 'fs';
import path from 'path';

// Parse arguments
const args = process.argv.slice(2);
const isDryRun = !args.includes('--apply');

console.log(`\n======================================================`);
console.log(`🚀 RECONCILIATION SCRIPT STARTED (Mode: ${isDryRun ? 'DRY-RUN' : 'APPLY'})`);
console.log(`======================================================\n`);

const dbPath = '.data/garageia.sqlite';
if (!fs.existsSync(dbPath)) {
    console.error('Database not found!');
    process.exit(1);
}

const db = SQLiteManager.getInstance().getDatabase();

const tables = ['customers', 'vehicles', 'subscriptions', 'debts', 'movements', 'cocheras'];
const report: any = {};

let totalMerges = 0;
let totalAmbiguous = 0;
const ambiguousDetails: any[] = [];
let subscription44Detail: any = null;
let subscription75Detail: any = null;

const case44SubId = '74fb9033-28e8-4baa-ae1f-2ed512e42434';
const case75SubId = '0fb4a3f1-5ded-4b88-84ad-e1cc6fb58387';

for (const table of tables) {
    console.log(`\n--- Analizando tabla: ${table} ---`);
    
    // Physical rows
    const physicalRows = db.prepare(`SELECT count(*) as count FROM ${table}`).get() as any;
    
    // Find all rows
    const allRows = db.prepare(`SELECT id as pk, json_data FROM ${table}`).all() as any[];
    
    // Group by logical ID
    const grouped = new Map<string, any[]>();
    for (const row of allRows) {
        const parsed = JSON.parse(row.json_data);
        const logicalId = parsed.id || row.pk;
        if (!grouped.has(logicalId)) grouped.set(logicalId, []);
        grouped.get(logicalId)!.push({ pk: row.pk, data: parsed, rawJson: row.json_data });
    }

    let logicalCount = grouped.size;
    let duplicateCount = 0;
    let safeMerges = 0;
    let ambiguous = 0;

    for (const [logicalId, copies] of grouped.entries()) {
        if (copies.length > 1) {
            duplicateCount++;
            
            // Separate into UUID row and NeDB rows
            const uuidRow = copies.find(c => c.pk === logicalId);
            const legacyRows = copies.filter(c => c.pk !== logicalId);

            if (!uuidRow) {
                // Should not happen based on our previous audit, but just in case
                console.warn(`WARNING: Logical ID ${logicalId} has duplicates but NO UUID row.`);
                continue;
            }

            for (const legacyRow of legacyRows) {
                let isAmbiguous = false;
                let mergedData = { ...uuidRow.data };
                let notes = [];

                if (table === 'debts') {
                    // Check for conflicts
                    const legacyStatus = legacyRow.data.status;
                    const uuidStatus = uuidRow.data.status;
                    
                    if (legacyStatus !== uuidStatus) {
                        // Conflict resolution needed
                        // Check if there is a movement for this debt
                        const movements = db.prepare(`
                            SELECT json_data FROM movements 
                            WHERE json_extract(json_data, '$.relatedEntityId') = ? 
                            OR json_extract(json_data, '$.notes') LIKE ?
                        `).all(legacyRow.data.subscriptionId || legacyRow.data.customerId, `%${logicalId.substring(0,8)}%`) as any[];
                        
                        const hasPaymentMovement = movements.some(m => {
                            const md = JSON.parse(m.json_data);
                            return md.notes && md.notes.includes(logicalId.substring(0,8)) && md.type === 'CobroAbono';
                        });

                        // If UUID is PAID, verify
                        if (uuidStatus === 'PAID') {
                            if (hasPaymentMovement) {
                                notes.push(`Status conflict: UUID is PAID, NeDB is ${legacyStatus}. Movement found. Kept PAID.`);
                            } else if (legacyRow.data.amount_paid > 0 && legacyRow.data.remaining_amount === 0) {
                                notes.push(`Status conflict: UUID is PAID, NeDB is ${legacyStatus}. NeDB remaining is 0. Kept PAID.`);
                            } else {
                                // Potentially ambiguous if UUID is PAID but no movement exists and NeDB says PENDING
                                isAmbiguous = true;
                                ambiguousDetails.push({ table, logicalId, issue: 'UUID is PAID but no movement and NeDB PENDING', legacy: legacyRow.data, uuid: uuidRow.data });
                            }
                        } else if (legacyStatus === 'PAID' && uuidStatus === 'PENDING') {
                            if (hasPaymentMovement) {
                                mergedData.status = 'PAID';
                                mergedData.remaining_amount = 0;
                                mergedData.amount_paid = mergedData.amount;
                                notes.push(`Status conflict: NeDB is PAID, UUID is PENDING. Movement found. Upgraded to PAID.`);
                            } else {
                                isAmbiguous = true;
                                ambiguousDetails.push({ table, logicalId, issue: 'NeDB is PAID but UUID PENDING with no movement', legacy: legacyRow.data, uuid: uuidRow.data });
                            }
                        }
                    }

                    // Merge financial fields (preferring legacy if UUID is missing them)
                    if (mergedData.remaining_amount === undefined && legacyRow.data.remaining_amount !== undefined) {
                        mergedData.remaining_amount = legacyRow.data.remaining_amount;
                        notes.push(`Merged remaining_amount: ${legacyRow.data.remaining_amount}`);
                    }
                    if (mergedData.amount_paid === undefined && legacyRow.data.amount_paid !== undefined) {
                        mergedData.amount_paid = legacyRow.data.amount_paid;
                        notes.push(`Merged amount_paid: ${legacyRow.data.amount_paid}`);
                    }

                    if (legacyRow.data.subscriptionId === case75SubId) {
                        subscription75Detail = subscription75Detail || { debts: [] };
                        subscription75Detail.debts.push({
                            logicalId,
                            legacyPk: legacyRow.pk,
                            uuidPk: uuidRow.pk,
                            legacyStatus: legacyRow.data.status,
                            uuidStatus: uuidRow.data.status,
                            mergedStatus: mergedData.status,
                            dueDate: legacyRow.data.dueDate,
                            legacyRemaining: legacyRow.data.remaining_amount,
                            uuidRemaining: uuidRow.data.remaining_amount,
                            mergedRemaining: mergedData.remaining_amount,
                            notes
                        });
                    }

                } else if (table === 'subscriptions') {
                    const legacyEnd = legacyRow.data.endDate ? new Date(legacyRow.data.endDate).getTime() : 0;
                    const uuidEnd = uuidRow.data.endDate ? new Date(uuidRow.data.endDate).getTime() : 0;
                    
                    if (legacyEnd > uuidEnd) {
                        // Why is legacy ahead of UUID? Check for movements
                        const movements = db.prepare(`SELECT * FROM movements WHERE json_extract(json_data, '$.relatedEntityId') = ?`).all(logicalId) as any[];
                        if (movements.length > 0) {
                            mergedData.endDate = legacyRow.data.endDate;
                            notes.push(`Legacy endDate ${legacyRow.data.endDate} is newer than UUID ${uuidRow.data.endDate}. Movement exists. Merged legacy endDate.`);
                        } else {
                            isAmbiguous = true;
                            ambiguousDetails.push({ table, logicalId, issue: 'Legacy endDate is newer but no movements found', legacy: legacyRow.data, uuid: uuidRow.data });
                        }
                    }

                    if (logicalId === case44SubId) {
                        const advanceMovement = db.prepare(`SELECT * FROM movements WHERE json_extract(json_data, '$.relatedEntityId') = ? AND json_extract(json_data, '$.notes') LIKE '%Anticip%'`).get(logicalId) as any;
                        subscription44Detail = {
                            legacyPk: legacyRow.pk,
                            uuidPk: uuidRow.pk,
                            legacyEndDate: legacyRow.data.endDate,
                            uuidEndDate: uuidRow.data.endDate,
                            mergedEndDate: mergedData.endDate,
                            advanceMovementFound: !!advanceMovement
                        };
                    }
                }

                if (isAmbiguous) {
                    ambiguous++;
                    totalAmbiguous++;
                } else {
                    safeMerges++;
                    totalMerges++;
                    if (!isDryRun) {
                        // Execution
                        const dbTx = db.transaction(() => {
                            db.prepare(`UPDATE ${table} SET json_data = ? WHERE id = ?`).run(JSON.stringify(mergedData), uuidRow.pk);
                            db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(legacyRow.pk);
                        });
                        dbTx();
                    }
                }
            }
        }
    }

    report[table] = {
        physicalRows: physicalRows.count,
        logicalEntities: logicalCount,
        duplicateEntities: duplicateCount,
        safeMerges,
        ambiguous
    };
    
    console.log(`  Physical rows: ${physicalRows.count}`);
    console.log(`  Logical entities: ${logicalCount}`);
    console.log(`  Duplicates found: ${duplicateCount}`);
    console.log(`  Safe merges: ${safeMerges}`);
    console.log(`  Ambiguous: ${ambiguous}`);
}

console.log(`\n======================================================`);
console.log(`📊 SUMMARY REPORT`);
console.log(`======================================================`);
console.table(report);
console.log(`Total Safe Merges Ready: ${totalMerges}`);
console.log(`Total Ambiguous (Needs manual resolution): ${totalAmbiguous}`);

if (subscription44Detail) {
    console.log(`\n🔍 CASE #44 (Subscription):`);
    console.log(`   Legacy PK: ${subscription44Detail.legacyPk} | UUID PK: ${subscription44Detail.uuidPk}`);
    console.log(`   Legacy EndDate: ${subscription44Detail.legacyEndDate} | UUID EndDate: ${subscription44Detail.uuidEndDate}`);
    console.log(`   Proposed Final EndDate: ${subscription44Detail.mergedEndDate}`);
    console.log(`   Advance Movement Found: ${subscription44Detail.advanceMovementFound}`);
}

if (subscription75Detail) {
    console.log(`\n🔍 CASE #75 (Debts):`);
    for (const d of subscription75Detail.debts) {
        console.log(`   - Debt ${d.logicalId.substring(0,8)} | Due: ${new Date(d.dueDate).toLocaleDateString()}`);
        console.log(`     Legacy: ${d.legacyStatus} (${d.legacyPk}) | UUID: ${d.uuidStatus} (${d.uuidPk})`);
        console.log(`     Legacy Rem: ${d.legacyRemaining} | UUID Rem: ${d.uuidRemaining} | Proposed Rem: ${d.mergedRemaining}`);
        console.log(`     Proposed Status: ${d.mergedStatus}`);
        if (d.notes.length > 0) console.log(`     Notes: ${d.notes.join(', ')}`);
    }
}

if (totalAmbiguous > 0) {
    console.log(`\n⚠️ AMBIGUOUS CASES:`);
    ambiguousDetails.slice(0, 5).forEach(a => {
        console.log(`   - [${a.table}] ${a.logicalId}: ${a.issue}`);
    });
    if (ambiguousDetails.length > 5) console.log(`   ...and ${ambiguousDetails.length - 5} more.`);
}

console.log(`\n======================================================`);
console.log(isDryRun ? `✅ DRY-RUN COMPLETED. No data was modified.` : `✅ RECONCILIATION APPLIED SUCCESSFULLY.`);
