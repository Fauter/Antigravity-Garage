import { SQLiteManager } from '../infrastructure/database/sqlite/SQLiteManager';
import { CocheraRepository } from '../modules/Garage/infra/CocheraRepository';
import { SubscriptionRepository } from '../modules/Garage/infra/SubscriptionRepository';

async function run() {
    process.env.STORAGE_ENGINE = 'SQLITE';
    SQLiteManager.getInstance().getDatabase();
    const cr = new CocheraRepository();
    const sr = new SubscriptionRepository();
    const cocheras = await cr.findAll();
    const subs = await sr.findAll();
    const cochera = cocheras.find(c => c.id === 'd6f66f70-9838-4878-9396-02e094b931ae');
    const matchedSubs = subs.filter(s => ['b2d91ca3-0979-47d4-b555-af72992a5d3a', '74fb9033-28e8-4baa-ae1f-2ed512e42434', '8dcbc370-384f-4757-b466-d3d51e756556', '4ddb3fca-9771-4e9a-a9ad-b4ae94c15b88', '9c63d756-885d-46f7-b5ae-f15cbdd38a4a', '7341f042-ce6b-4b46-9b41-129f65bd88f4', '8aa04084-dce0-4a7d-8ea4-95fbba84085b'].includes(s.id));
    
    console.log('Cochera:', JSON.stringify(cochera, null, 2));
    console.log('Matched Subs Active Statuses:');
    matchedSubs.forEach(s => console.log(s.id, s.active));
}
run();
