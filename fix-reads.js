const fs = require('fs');
const path = require('path');

const gCtrlPath = path.join(__dirname, 'src/modules/Garage/infra/GarageController.ts');
let gCtrl = fs.readFileSync(gCtrlPath, 'utf8');

gCtrl = gCtrl.replace(/db\.prices\.find\(\{\s*garageId,\s*priceList:\s*([^}]+)\s*\}\)/g, '(new ConfigRepository()).getPrices(garageId, $1)');
gCtrl = gCtrl.replace(/db\.prices\.find\(\{\s*garageId\s*\}\)/g, '(new ConfigRepository()).getPrices(garageId, "standard")');
gCtrl = gCtrl.replace(/db\.vehicleTypes\.find\(\{\s*garageId\s*\}\)/g, '(new ConfigRepository()).getVehicleTypes(garageId)');
gCtrl = gCtrl.replace(/db\.tariffs\.find\(\{\s*garageId\s*\}\)/g, '(new ConfigRepository()).getTariffs(garageId)');
gCtrl = gCtrl.replace(/db\.financialConfigs\.find\(\{\s*garageId\s*\}\)/g, '[(await (new ConfigRepository()).getParams(garageId))]');
gCtrl = gCtrl.replace(/db\.financialConfigs\.find\(\{\}\)/g, '[(await (new ConfigRepository()).getParams())]');
gCtrl = gCtrl.replace(/await db\.garages\.findOne\(\{ id: garageId \}\)/g, 'await (require("../../../infrastructure/database/sqlite/SQLiteManager").SQLiteManager.getInstance().getDatabase().prepare("SELECT * FROM garages WHERE id = ?").get(garageId) || {})');
gCtrl = gCtrl.replace(/await db\.partialCloses\.find\(\{\}\)/g, 'await (new (require("./PartialCloseRepository").PartialCloseRepository)()).findAll()');
gCtrl = gCtrl.replace(/await db\.shiftCloses\.find\(\{\}\)/g, 'await (new (require("./ShiftCloseRepository").ShiftCloseRepository)()).findAll()');
gCtrl = gCtrl.replace(/\(this\.vehicleRepo as any\)\.db\.delete/g, 'this.vehicleRepo.delete');
gCtrl = gCtrl.replace(/\(this\.customerRepo as any\)\.db\.delete/g, 'this.customerRepo.delete');

fs.writeFileSync(gCtrlPath, gCtrl);

const rPath = path.join(__dirname, 'src/modules/Configuration/http/routes.ts');
if (fs.existsSync(rPath)) {
    let routes = fs.readFileSync(rPath, 'utf8');
    routes = routes.replace(/db\.tariffs\.find\(\{\s*garageId\s*\}\)/g, '(new ConfigRepository()).getTariffs(garageId)');
    routes = routes.replace(/db\.vehicleTypes\.find\(\{\s*garageId\s*\}\)/g, '(new ConfigRepository()).getVehicleTypes(garageId)');
    routes = routes.replace(/db\.prices\.find\(\{\s*garageId\s*\}\)/g, '(new ConfigRepository()).getPrices(garageId, "standard")');
    routes = routes.replace(/await db\.buildingLevels\.find\(\{\s*garageId\s*\}\)/g, 'await (require("../../../infrastructure/database/sqlite/SQLiteManager").SQLiteManager.getInstance().getDatabase().prepare("SELECT * FROM building_levels WHERE garage_id = ?").all(garageId))');
    fs.writeFileSync(rPath, routes);
}
