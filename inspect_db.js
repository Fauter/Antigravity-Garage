
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

function inspectDb(name, path, garageId) {
    if (!fs.existsSync(path)) {
        console.log(`\n[${name}] DB not found at: ${path}`);
        return;
    }
    const db = new DatabaseSync(path);
    console.log(`\n[${name}] DB Found at ${path}`);
    
    const tables = ["vehicle_types", "tariffs", "prices", "garages", "employees", "sync_checkpoints"];
    for (const table of tables) {
        try {
            const count = db.prepare(`SELECT count(*) as c FROM ${table}`).get().c;
            console.log(`${table} count: ${count}`);
        } catch(e) {
            console.log(`${table} error: ${e.message}`);
        }
    }
    
    try {
        const vt = db.prepare("SELECT * FROM vehicle_types LIMIT 5").all();
        console.log("vehicle_types samples:");
        vt.forEach(r => {
            try {
                const parsed = JSON.parse(r.json_data);
                console.log(`  id: ${r.id}, name: ${parsed.name}, garageId: ${parsed.garageId || parsed.garage_id}`);
            } catch(ex) {
                console.log(`  id: ${r.id}, unparseable json_data: ${r.json_data}`);
            }
        });
    } catch(e) {
        console.log("vehicle_types sample error:", e.message);
    }
}

const devPath = "./.data/garageia.sqlite";
const prodPath = "C:\\\\Users\\\\lmfau\\\\AppData\\\\Roaming\\\\GarageIA\\\\database\\\\garageia.sqlite";
const garageId = "1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02";

inspectDb("DEV", devPath, garageId);
inspectDb("PROD", prodPath, garageId);

