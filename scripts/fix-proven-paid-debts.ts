import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';

async function main() {
    const db = SQLiteManager.getInstance().getDatabase();
    
    const cases = [
        {
            id: '8b685247-c448-564b-a3bd-a5398bebce16',
            desc: '#75 Mayo',
            expectedStatus: 'PAID',
            expectedRemaining: 860000,
            expectedAmountPaid: 0,
            fixRemaining: 0,
            fixAmountPaid: 860000
        },
        {
            id: 'bc543ac8-6f07-5788-b0f0-68c722b0d71f',
            desc: '#89 Junio',
            expectedStatus: 'PAID',
            expectedRemaining: 310000,
            expectedAmountPaid: 0,
            fixRemaining: 0,
            fixAmountPaid: 310000
        }
    ];

    console.log(`\n======================================================`);
    console.log(`🛠️ FIX PROVEN PAID DEBTS (FASE 2C)`);
    console.log(`======================================================\n`);

    db.exec('BEGIN IMMEDIATE;');
    try {
        for (const c of cases) {
            console.log(`[VERIFYING] ${c.desc} (${c.id})`);
            const rowRaw = db.prepare(`SELECT * FROM debts WHERE id = ?`).get(c.id) as any;
            if (!rowRaw) {
                throw new Error(`Debt ${c.id} not found.`);
            }
            
            const debt = JSON.parse(rowRaw.json_data);
            const remaining = debt.remainingAmount !== undefined ? debt.remainingAmount : debt.remaining_amount;
            const paid = debt.amountPaid !== undefined ? debt.amountPaid : debt.amount_paid;
            
            console.log(`  Current State: Status=${debt.status}, Remaining=${remaining}, Paid=${paid}`);
            
            if (debt.status !== c.expectedStatus || remaining !== c.expectedRemaining || paid !== c.expectedAmountPaid) {
                throw new Error(`State mismatch for ${c.desc}! Expected Status=${c.expectedStatus}, Remaining=${c.expectedRemaining}, Paid=${c.expectedAmountPaid}. Aborting.`);
            }

            // Normalization
            debt.status = 'PAID';
            debt.remainingAmount = c.fixRemaining;
            debt.amountPaid = c.fixAmountPaid;
            // Legacy fallbacks for compatibility
            debt.remaining_amount = c.fixRemaining;
            debt.amount_paid = c.fixAmountPaid;

            db.prepare(`UPDATE debts SET json_data = ? WHERE id = ?`).run(JSON.stringify(debt), c.id);
            
            console.log(`  -> Fixed: Status=PAID, Remaining=${c.fixRemaining}, Paid=${c.fixAmountPaid}\n`);
        }
        
        db.exec('COMMIT;');
        console.log(`✅ Transaction committed successfully.`);
    } catch (err: any) {
        db.exec('ROLLBACK;');
        console.error(`❌ Transaction failed and rolled back:`, err.message);
        process.exit(1);
    }
}

main().catch(console.error);
