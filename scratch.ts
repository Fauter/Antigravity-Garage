import { db } from './src/infrastructure/database/datastore.js';
async function run() {
  await db.shiftCloses.insert({
    id: 'test',
    operator: 'WALTER',
    staying_in_cash: 100,
    timestamp: new Date()
  });
  const results = await db.shiftCloses.find({});
  console.log(results);
}
run();
