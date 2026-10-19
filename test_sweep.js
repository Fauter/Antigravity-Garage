const sqlite3 = require('better-sqlite3');
const db = new sqlite3('.data/garageia.sqlite');
db.pragma('journal_mode = WAL');

const fs = require('fs');

const { SQLiteManager } = require('./dist/infrastructure/database/sqlite/SQLiteManager.js');

(async () => {
  // Mock the server logic manually to see why it skips October
  const now = new Date();
  const subEndDate = new Date("2026-10-01T02:59:59.999Z");
  console.log("subEndDate:", subEndDate);
  let currentEvalDate = new Date(subEndDate.getTime());
  currentEvalDate.setDate(1);
  currentEvalDate.setMonth(currentEvalDate.getMonth() + 1);
  currentEvalDate.setHours(0, 0, 0, 0);

  console.log("currentEvalDate:", currentEvalDate);
  console.log("now:", now);
  console.log("currentEvalDate <= now:", currentEvalDate <= now);

})();
