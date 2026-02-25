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

    // For debts: remove with 36 chars id (uuidv4) or duplicate deterministic
    const seenMap = new Set();

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const obj = JSON.parse(line);

            // It's a mutation
            if (obj.entityType === 'Debt') {
                if (obj.payload && obj.payload.id && obj.payload.id.length === 36) {
                    removed++;
                    continue; // Skip it
                }
            }

            // It's a debt
            if (obj.subscriptionId) {
                if (obj.id && obj.id.length === 36) {
                    removed++;
                    continue;
                }

                if (obj.dueDate) {
                    const dDate = new Date(obj.dueDate);
                    const key = `${obj.subscriptionId}_${dDate.getFullYear()}_${dDate.getMonth() + 1}`;
                    if (seenMap.has(key)) {
                        removed++;
                        continue;
                    } else {
                        seenMap.add(key);
                    }
                }
            }

            keepLines.push(line);
        } catch (e) {
            keepLines.push(line);
        }
    }

    fs.writeFileSync(filePath, keepLines.join('\n') + '\n');
    console.log(`Removed ${removed} problematic records from ${path.basename(filePath)}`);
}

cleanDB(debtsFile);
cleanDB(mutFile);
