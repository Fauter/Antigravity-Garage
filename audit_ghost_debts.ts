if (!process.argv.includes('--db-path')) {
    console.error('ERROR: You must provide a safe offline path via --db-path to avoid corrupting the production NeDB instances.');
    process.exit(1);
}

import { db } from './src/infrastructure/database/datastore';
import fs from 'fs';

async function run() {
    const docs = await db.debts.find({});
    console.log("Total debts:", docs.length);
    
    // find ghosts
    const ghosts = docs.filter((d: any) => !d.garageId || d.garageId === 'NULL' || d.garageId === null);
    console.log("Ghosts count:", ghosts.length);
    
    // try to match with real debts
    const map = new Map();
    docs.forEach((d: any) => {
        if (!d.subscriptionId) return;
        if (!map.has(d.subscriptionId)) map.set(d.subscriptionId, { reals: [], ghosts: [] });
        if (!d.garageId || d.garageId === 'NULL' || d.garageId === null) {
            map.get(d.subscriptionId).ghosts.push(d);
        } else {
            map.get(d.subscriptionId).reals.push(d);
        }
    });

    const output = [];
    let exactMatches = 0;
    for (const [subId, data] of map) {
        if (data.ghosts.length > 0) {
            output.push(`--- Subscription: ${subId} ---`);
            data.ghosts.forEach((g: any) => {
                output.push(`GHOST: id=${g.id}, due=${g.dueDate}, amount=${g.amount}, created=${g.createdAt}`);
                const matches = data.reals.filter((r: any) => {
                    const t1 = new Date(r.dueDate).getTime();
                    const t2 = new Date(g.dueDate).getTime();
                    return Math.abs(t1 - t2) < 1000 * 60 * 60 * 24 * 5; // within 5 days
                });
                matches.forEach((m: any) => {
                    output.push(`  REAL: id=${m.id}, due=${m.dueDate}, amount=${m.amount}, created=${m.createdAt}, garage=${m.garageId}, status=${m.status}`);
                    exactMatches++;
                });
            });
            output.push('\n');
        }
    }
    fs.writeFileSync('ghost_debts_analysis.txt', output.join('\n'));
    console.log("Exact matches found:", exactMatches);
    console.log("Done. See ghost_debts_analysis.txt");
}
run().catch(console.error);
