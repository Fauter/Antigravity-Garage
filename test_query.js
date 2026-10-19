const Database = require('better-sqlite3');
const db = new Database('.data/garageia.sqlite');
const rows = db.prepare("SELECT id, json_data FROM debts WHERE json_extract(json_data, '$.customerId') = ? OR json_extract(json_data, '$.customer_id') = ?").all("6469d975-e753-47d2-b8e5-f5be42ac7028", "6469d975-e753-47d2-b8e5-f5be42ac7028");
console.log(rows);
