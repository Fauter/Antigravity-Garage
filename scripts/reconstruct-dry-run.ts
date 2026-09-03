import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import fs from 'fs';
import readline from 'readline';

async function main() {
    const db = SQLiteManager.getInstance().getDatabase();
    
    const case75SubId = '0fb4a3f1-5ded-4b88-84ad-e1cc6fb58387';
    const case44SubId = '74fb9033-28e8-4baa-ae1f-2ed512e42434';

    console.log(`\n======================================================`);
    console.log(`🔍 RECONSTRUCTING DRY-RUN REPORT FROM NEDB BACKUPS`);
    console.log(`======================================================\n`);

    // --- CASE 75 (Debts) ---
    console.log(`--- CASE #75 ---`);
    const nedbDebts: any[] = [];
    const rlDebts = readline.createInterface({
        input: fs.createReadStream('.data/debts.db'),
        crlfDelay: Infinity
    });
    for await (const line of rlDebts) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.subscriptionId === case75SubId) {
            nedbDebts.push(parsed);
        }
    }

    const sqliteDebts = db.prepare(`SELECT * FROM debts WHERE json_extract(json_data, '$.subscriptionId') = ?`).all(case75SubId) as any[];
    
    // Group by logical UUID
    const allIds = new Set([...nedbDebts.map(d => d.id), ...sqliteDebts.map(d => d.id)]);
    for (const id of allIds) {
        const nedb = nedbDebts.find(d => d.id === id);
        const sqliteRaw = sqliteDebts.find(d => d.id === id);
        const sqlite = sqliteRaw ? JSON.parse(sqliteRaw.json_data) : null;
        
        console.log(`Debt Logical ID: ${id.substring(0,8)}`);
        
        if (nedb) {
            console.log(`  NeDB (Legacy): PK=${nedb._id}, Status=${nedb.status}, Remaining=${nedb.remaining_amount}, Paid=${nedb.amount_paid}, Due=${nedb.dueDate}`);
        } else {
            console.log(`  NeDB (Legacy): NOT FOUND (Created post-migration?)`);
        }
        
        if (sqlite) {
            const rem = sqlite.remainingAmount !== undefined ? sqlite.remainingAmount : sqlite.remaining_amount;
            const paid = sqlite.amountPaid !== undefined ? sqlite.amountPaid : sqlite.amount_paid;
            console.log(`  SQLite (UUID): PK=${sqliteRaw.id}, Status=${sqlite.status}, Remaining=${rem}, Paid=${paid}`);
        } else {
            console.log(`  SQLite (UUID): NOT FOUND`);
        }
        
        // Find movements
        const movements = db.prepare(`SELECT * FROM movements WHERE json_extract(json_data, '$.relatedEntityId') = ? OR json_extract(json_data, '$.notes') LIKE ?`).all(case75SubId, `%${id.substring(0,8)}%`) as any[];
        console.log(`  Movements found: ${movements.length}`);
        
        // Canonical resolution
        const status = sqlite ? sqlite.status : nedb.status;
        const finalRem = status === 'PAID' ? 0 : (nedb ? nedb.remaining_amount : sqlite.remainingAmount);
        console.log(`  > Proposed Canonical: Status=${status}, Remaining=${finalRem}\n`);
    }

    // --- CASE 44 (Subscriptions) ---
    console.log(`--- CASE #44 ---`);
    let nedbSub44 = null;
    const rlSubs = readline.createInterface({
        input: fs.createReadStream('.data/subscriptions.db'),
        crlfDelay: Infinity
    });
    for await (const line of rlSubs) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id === case44SubId || parsed._id === case44SubId) {
            nedbSub44 = parsed;
        }
    }

    const sqliteSub44Raw = db.prepare(`SELECT * FROM subscriptions WHERE json_extract(json_data, '$.id') = ?`).get(case44SubId) as any;
    const sqliteSub44 = sqliteSub44Raw ? JSON.parse(sqliteSub44Raw.json_data) : null;

    console.log(`Subscription Logical ID: ${case44SubId}`);
    if (nedbSub44) {
        console.log(`  NeDB (Legacy): PK=${nedbSub44._id}, EndDate=${nedbSub44.endDate || nedbSub44.end_date}`);
    }
    if (sqliteSub44) {
        console.log(`  SQLite (UUID): PK=${sqliteSub44Raw.id}, EndDate=${sqliteSub44.endDate || sqliteSub44.end_date}`);
    }

    const advanceMovement = db.prepare(`SELECT json_data FROM movements WHERE json_extract(json_data, '$.relatedEntityId') = ? AND json_extract(json_data, '$.notes') LIKE '%Anticip%'`).get(case44SubId) as any;
    console.log(`  Advance Movement: ${advanceMovement ? 'YES' : 'NO'}`);
    
    const finalEnd = sqliteSub44 ? (sqliteSub44.endDate || sqliteSub44.end_date) : (nedbSub44.endDate || nedbSub44.end_date);
    console.log(`  > Proposed Canonical EndDate: ${finalEnd}\n`);

}

main().catch(console.error);
