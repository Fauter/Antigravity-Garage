import { db } from './src/infrastructure/database/datastore';
import fs from 'fs';

async function run() {
    const docs = await db.debts.find({});
    const map = new Map<string, any[]>();
    docs.forEach(d => {
        if (!d.id) return;
        if (!map.has(d.id)) map.set(d.id, []);
        map.get(d.id)!.push(d);
    });

    const output: string[] = [];
    for (const [id, grouped] of map) {
        if (grouped.length > 1) {
            output.push(`--- DUPLICATE ID: ${id} ---`);
            grouped.forEach(g => {
                const copy = {...g};
                delete copy._id;
                delete copy.id;
                output.push(`_id: ${g._id}`);
                output.push(JSON.stringify(copy, null, 2));
            });
            output.push('\n');
        }
    }
    fs.writeFileSync('duplicate_debts_analysis.txt', output.join('\n'));
    console.log("Done.");
}

run().catch(console.error);
