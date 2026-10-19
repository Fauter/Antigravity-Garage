const { SQLiteManager } = require('./dist/infrastructure/database/sqlite/SQLiteManager.js');
const { GarageController } = require('./dist/modules/Garage/infra/GarageController.js');
const { SqliteDebtRepository } = require('./dist/modules/Garage/infra/SqliteDebtRepository.js');
const { SqliteSubscriptionRepository } = require('./dist/modules/Garage/infra/SqliteSubscriptionRepository.js');

(async () => {
  const gc = new GarageController();
  const subRepo = new SqliteSubscriptionRepository();
  const sub = await subRepo.findById('0e8e00b4-0884-422c-8024-2d0d78f97217');
  
  const vt = await gc['resolveVehicleTypeId'](sub, 'ebf7eaa0-339e-455f-bcde-dd51636e1f21');
  console.log("Resolved Vehicle Type Id:", vt);
})();
