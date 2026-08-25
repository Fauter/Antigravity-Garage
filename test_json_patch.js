const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');

const testCases = [
  // CASE 1: json_data.field = "valuable", legacy column = NULL
  { json: '{"field":"valuable"}', legacy: null },
  // CASE 2: json_data.field = "valuable", legacy column = "new"
  { json: '{"field":"valuable"}', legacy: "new" },
  // CASE 3: json_data has no field, legacy = NULL
  { json: '{}', legacy: null },
  // CASE 4: json_data has no field, legacy = "legacy"
  { json: '{}', legacy: "legacy" },
  // CASE 5: json_data.field = null, legacy = "legacy"
  { json: '{"field":null}', legacy: "legacy" },
  // CASE 6: json_data.field = false, legacy = NULL
  { json: '{"field":false}', legacy: null },
];

for (let i = 0; i < testCases.length; i++) {
  const t = testCases[i];
  const legacyVal = t.legacy === null ? 'NULL' : `'${t.legacy}'`;
  
  // Forward patch: json_patch(legacy, json)
  const queryForward = `SELECT json_patch(json_object('field', ${legacyVal}), '${t.json}') AS r`;
  const resForward = db.prepare(queryForward).get();
  
  // Reverse patch: json_patch(json, legacy)
  const queryReverse = `SELECT json_patch('${t.json}', json_object('field', ${legacyVal})) AS r`;
  const resReverse = db.prepare(queryReverse).get();

  console.log(`CASE ${i+1}: json=${t.json}, legacy=${t.legacy}`);
  console.log(`  Forward (legacy patched by json):`, resForward.r);
  console.log(`  Reverse (json patched by legacy):`, resReverse.r);
}
