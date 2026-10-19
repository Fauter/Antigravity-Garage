const { SQLiteManager } = require('./dist/infrastructure/database/sqlite/SQLiteManager.js');
const { GarageController } = require('./dist/modules/Garage/infra/GarageController.js');

(async () => {
  SQLiteManager.getInstance().initialize();
  const controller = new GarageController();
  const req = {
    headers: { 'x-garage-id': 'ebf7eaa0-339e-455f-bcde-dd51636e1f21' }
  };
  const res = {
    json: (data) => console.log('JSON:', data),
    status: (code) => ({ json: (data) => console.log('STATUS', code, 'JSON:', data) })
  };
  await controller.triggerDebtSweep(req, res);
})();
