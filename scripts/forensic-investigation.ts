import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import fs from 'fs';
import readline from 'readline';

async function main() {
    const db = SQLiteManager.getInstance().getDatabase();
    
    const ambiguousIds = [
        '8b685247-c448-564b-a3bd-a5398bebce16',
        'bc543ac8-6f07-5788-b0f0-68c722b0d71f'
    ];

    console.log(`\n======================================================`);
    console.log(`🔍 FORENSIC INVESTIGATION`);
    console.log(`======================================================\n`);

    // Load NeDB backups for comparison
    const nedbDebts = new Map();
    if (fs.existsSync('.data/debts.db')) {
        const rlDebts = readline.createInterface({ input: fs.createReadStream('.data/debts.db') });
        for await (const line of rlDebts) {
            if (!line.trim()) continue;
            const parsed = JSON.parse(line);
            nedbDebts.set(parsed.id, parsed);
        }
    }
    
    const nedbMovements = [];
    if (fs.existsSync('.data/movements.db')) {
        const rlMovs = readline.createInterface({ input: fs.createReadStream('.data/movements.db') });
        for await (const line of rlMovs) {
            if (line.trim()) nedbMovements.push(JSON.parse(line));
        }
    }

    for (const debtId of ambiguousIds) {
        console.log(`\n------------------------------------------------------`);
        console.log(`🔎 INVESTIGATING DEBT: ${debtId}`);
        
        // 1. Current SQLite state
        const sqliteDebtRaw = db.prepare(`SELECT * FROM debts WHERE id = ?`).get(debtId) as any;
        const sqliteDebt = sqliteDebtRaw ? JSON.parse(sqliteDebtRaw.json_data) : null;
        
        const nedbDebt = nedbDebts.get(debtId);
        
        console.log(`\n[STATE]`);
        if (sqliteDebt) {
            console.log(`  SQLite: Status=${sqliteDebt.status}, Amount=${sqliteDebt.amount}, Remaining=${sqliteDebt.remainingAmount ?? sqliteDebt.remaining_amount}, Paid=${sqliteDebt.amountPaid ?? sqliteDebt.amount_paid}, Due=${sqliteDebt.dueDate}`);
            console.log(`          Created=${sqliteDebt.createdAt}, Updated=${sqliteDebt.updatedAt}`);
        }
        if (nedbDebt) {
            console.log(`  NeDB:   Status=${nedbDebt.status}, Amount=${nedbDebt.amount}, Remaining=${nedbDebt.remaining_amount}, Paid=${nedbDebt.amount_paid}, Due=${nedbDebt.dueDate}`);
            console.log(`          Created=${JSON.stringify(nedbDebt.createdAt)}, Updated=${JSON.stringify(nedbDebt.updatedAt)}`);
        }
        
        const subId = sqliteDebt?.subscriptionId || nedbDebt?.subscriptionId;
        const custId = sqliteDebt?.customerId || nedbDebt?.customerId;
        
        console.log(`\n[CONTEXT]`);
        console.log(`  Subscription ID: ${subId}`);
        console.log(`  Customer ID: ${custId}`);
        
        const sub = db.prepare(`SELECT json_data FROM subscriptions WHERE id = ?`).get(subId) as any;
        if (sub) {
            const parsedSub = JSON.parse(sub.json_data);
            console.log(`  Current Sub EndDate: ${parsedSub.endDate || parsedSub.end_date}, Active: ${parsedSub.active}`);
        }

        console.log(`\n[MOVEMENTS]`);
        // Find all movements in SQLite that might be related
        const movs = db.prepare(`SELECT json_data FROM movements WHERE json_extract(json_data, '$.relatedEntityId') IN (?, ?) OR json_extract(json_data, '$.customerId') = ?`).all(subId, custId, custId) as any[];
        const allMovs = movs.map(m => JSON.parse(m.json_data));
        
        // Add NeDB movements just in case they were lost
        for (const nm of nedbMovements) {
            if ((nm.relatedEntityId === subId || nm.relatedEntityId === custId || nm.customerId === custId) && !allMovs.find(m => m.id === nm.id)) {
                allMovs.push(nm);
            }
        }
        
        // Sort chronologically
        allMovs.sort((a, b) => {
            const dateA = a.createdAt?.['$$date'] ? a.createdAt['$$date'] : new Date(a.createdAt).getTime();
            const dateB = b.createdAt?.['$$date'] ? b.createdAt['$$date'] : new Date(b.createdAt).getTime();
            return dateA - dateB;
        });
        
        let foundDirectMatch = false;
        let totalPaidInPeriod = 0;
        
        for (const m of allMovs) {
            const isRelatedToSub = m.relatedEntityId === subId || m.notes?.includes(subId?.substring(0,8));
            const hasDebtId = m.notes?.includes(debtId.substring(0,8)) || m.relatedEntityId === debtId;
            const matchStr = hasDebtId ? " ⭐ DIRECT MATCH" : (isRelatedToSub ? " 🔸 SUB MATCH" : " 🔹 CUST MATCH");
            
            const date = m.createdAt?.['$$date'] ? new Date(m.createdAt['$$date']).toISOString() : m.createdAt;
            console.log(`  [${date}] Type: ${m.type} | Amount: ${m.amount}${matchStr}`);
            console.log(`    Notes: ${m.notes}`);
            
            if (hasDebtId) foundDirectMatch = true;
            if (isRelatedToSub && m.type === 'CobroAbono') {
                totalPaidInPeriod += m.amount;
            }
        }
        
        console.log(`\n[OUTBOX EVENTS]`);
        const outbox = db.prepare(`SELECT * FROM outbox_events WHERE entity_id = ?`).all(debtId) as any[];
        for (const o of outbox) {
            console.log(`  [${o.created_at}] Operation: ${o.operation}, Status: ${o.status}`);
            console.log(`    Payload: ${o.payload.substring(0, 100)}...`);
        }
    }
}

main().catch(console.error);
