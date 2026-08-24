const fs = require('fs');
const path = require('path');
const sPath = path.join(__dirname, 'src/infrastructure/http/server.ts');
let serverTs = fs.readFileSync(sPath, 'utf8');
const getDbCode = `require('../database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase()`;
serverTs = serverTs.replace(/await db\.stays\.find\(\{ garageId \}\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?").all(garageId).map((r: any) => JSON.parse(r.json_data)))`);
serverTs = serverTs.replace(/await db\.promos\.find\(\{ garageId, activo: true \}\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM promos WHERE json_extract(json_data, '$.garageId') = ? AND json_extract(json_data, '$.activo') = true").all(garageId).map((r: any) => JSON.parse(r.json_data)))`);
serverTs = serverTs.replace(/await db\.stays\.find\(\{ ticket_code: normalizedCode \} as any\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.ticket_code') = ?").all(normalizedCode).map((r: any) => JSON.parse(r.json_data)))`);
serverTs = serverTs.replace(/await db\.stays\.find\(\{\}\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays").all().map((r: any) => JSON.parse(r.json_data)))`);
serverTs = serverTs.replace(/await db\.vehicles\?\.find\(\{ rfid_tag: rfidCode \} as any\) \?\? \[\]/g, `await (${getDbCode}.prepare("SELECT json_data FROM vehicles WHERE json_extract(json_data, '$.rfid_tag') = ?").all(rfidCode).map((r: any) => JSON.parse(r.json_data)))`);
serverTs = serverTs.replace(/await db\.stays\.find\(\{\s*plate,\s*active:\s*true,\s*\}\s*as any\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.plate') = ? AND json_extract(json_data, '$.active') = true").all(plate).map((r: any) => JSON.parse(r.json_data)))`);
serverTs = serverTs.replace(/await db\.stays\.find\(\{ plate \} as any\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.plate') = ?").all(plate).map((r: any) => JSON.parse(r.json_data)))`);
serverTs = serverTs.replace(/await db\.stays\.find\(query\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.is_pending_processing') = true" + (garageId ? " AND json_extract(json_data, '$.garageId') = ?" : "")).all(garageId ? [garageId] : []).map((r: any) => JSON.parse(r.json_data)))`);
fs.writeFileSync(sPath, serverTs);

// Replace `await db.stays.find({})`
serverTs = serverTs.replace(/await db\.stays\.find\(\{\}\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays").all().map(r => JSON.parse(r.json_data)))`);

// Replace `await db.vehicles?.find({ rfid_tag: rfidCode } as any) ?? []`
serverTs = serverTs.replace(/await db\.vehicles\?\.find\(\{ rfid_tag: rfidCode \} as any\) \?\? \[\]/g, `await (${getDbCode}.prepare("SELECT json_data FROM vehicles WHERE json_extract(json_data, '$.rfid_tag') = ?").all(rfidCode).map(r => JSON.parse(r.json_data)))`);

// Replace `await db.stays.find({ plate, active: true })` -> Wait, it spans multiple lines. Let's use a generic replace for it.
serverTs = serverTs.replace(/await db\.stays\.find\(\{\s*plate,\s*active:\s*true,\s*is_pending_processing:\s*false\s*\}\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.plate') = ? AND json_extract(json_data, '$.active') = true AND json_extract(json_data, '$.is_pending_processing') = false").all(plate).map(r => JSON.parse(r.json_data)))`);

// Replace `await db.stays.find({ plate } as any)`
serverTs = serverTs.replace(/await db\.stays\.find\(\{ plate \} as any\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.plate') = ?").all(plate).map(r => JSON.parse(r.json_data)))`);

// Replace `await db.stays.find(query)` for pending
serverTs = serverTs.replace(/await db\.stays\.find\(query\)/g, `await (${getDbCode}.prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.is_pending_processing') = true" + (garageId ? " AND json_extract(json_data, '$.garageId') = ?" : "")).all(garageId ? [garageId] : []).map(r => JSON.parse(r.json_data)))`);

fs.writeFileSync(sPath, serverTs);
