const { SQLiteManager } = require('./dist/infrastructure/database/sqlite/SQLiteManager.js');
const { SqliteDebtRepository } = require('./dist/modules/Garage/infra/SqliteDebtRepository.js');

SQLiteManager.getInstance().initialize();
const repo = new SqliteDebtRepository();
repo.findByCustomerId('6469d975-e753-47d2-b8e5-f5be42ac7028').then(debts => {
  console.log(JSON.stringify(debts, null, 2));
}).catch(console.error);
