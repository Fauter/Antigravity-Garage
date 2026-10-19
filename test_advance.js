
const { TransactionHelper } = require("./src/infrastructure/database/sqlite/TransactionHelper.js");
const { SQLiteManager } = require("./src/infrastructure/database/sqlite/SQLiteManager.js");
const db = SQLiteManager.getInstance().getDatabase();
console.log(db);

