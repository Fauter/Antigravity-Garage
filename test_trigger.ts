import { SQLiteManager } from './src/infrastructure/database/sqlite/SQLiteManager';
import { GarageController } from './src/modules/Garage/infra/GarageController';

(async () => {
  SQLiteManager.getInstance().initialize();
  const controller = new GarageController();
  const req = {
    headers: { 'x-garage-id': 'ebf7eaa0-339e-455f-bcde-dd51636e1f21' }
  } as any;
  const res = {
    json: (data) => console.log('JSON:', data),
    status: (code) => ({ json: (data) => console.log('STATUS', code, 'JSON:', data) })
  } as any;
  await controller.triggerDebtSweep(req, res);
})();
