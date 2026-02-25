import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const debtsFile = path.join(DATA_DIR, 'debts.db');
const mutFile = path.join(DATA_DIR, 'mutations.db');

function cleanDB(filePath) {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    let keepLines = [];
    let removed = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const obj = JSON.parse(line);

            // It's a mutation
            if (obj.entityType === 'Debt') {
                if (obj.payload && obj.payload.id && obj.payload.id.startsWith('DEBT_')) {
                    removed++;
                    continue; // Skip it
                }
            }

            // It's a debt
            if (obj.subscriptionId) {
                if (obj.id && obj.id.startsWith('DEBT_')) {
                    removed++;
                    continue;
                }
            }

            keepLines.push(line);
        } catch (e) {
            keepLines.push(line);
        }
    }

    fs.writeFileSync(filePath, keepLines.join('\n') + '\n');
    console.log(`Removed ${removed} text records from ${path.basename(filePath)}`);
}

cleanDB(debtsFile);
cleanDB(mutFile);
