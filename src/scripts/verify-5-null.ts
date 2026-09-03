import { SQLiteManager } from '../infrastructure/database/sqlite/SQLiteManager';
import { SubscriptionRepository } from '../modules/Garage/infra/SubscriptionRepository';
import { supabase } from '../infrastructure/lib/supabase';

async function run() {
    process.env.STORAGE_ENGINE = 'SQLITE';
    const dbInstance = SQLiteManager.getInstance().getDatabase();
    
    const subRepo = new SubscriptionRepository();
    const localSubs = await subRepo.findAll();
    
    const withCocheraId = localSubs.filter((s: any) => s.cocheraId != null);
    const withoutCocheraId = localSubs.filter((s: any) => s.cocheraId == null);
    
    const { data: remoteSubs, error } = await supabase.from('subscriptions').select('*');
    if (error) {
        console.error('Error fetching remote subs:', error);
        return;
    }

    console.log(`--- Análisis de los 5 locales sin cocheraId ---`);
    console.log(`subscriptionId | customerId | type | active | spotNumber | plate/vehicleId | existeEnSupabase | remote.cochera_id | Motivo_Clasificacion`);

    for (const sub of withoutCocheraId) {
        const remote = remoteSubs.find(r => r.id === sub.id);
        const subId = sub.id;
        const customerId = sub.customerId;
        const type = sub.type;
        const active = (sub as any).active;
        const spotNumber = sub.spotNumber || 'N/A';
        const plateStr = (sub as any).vehicleData?.plate || (sub as any).plate || (sub as any).vehicleId || 'N/A';
        
        let existeEnSupabase = 'NO';
        let remoteCocheraId = 'N/A';
        let clasificacion = 'D. OTHER_ANOMALY';

        if (remote) {
            existeEnSupabase = 'SI';
            remoteCocheraId = remote.cochera_id === null ? 'NULL' : String(remote.cochera_id);
            if (remote.cochera_id === null) {
                clasificacion = 'A. REMOTE_NULL_OK';
            } else {
                clasificacion = 'C. REMOTE_HAS_UNEXPECTED_COHERA_ID';
            }
        } else {
            clasificacion = 'B. NOT_PRESENT_REMOTE';
        }

        console.log(`${subId} | ${customerId} | ${type} | ${active} | ${spotNumber} | ${plateStr} | ${existeEnSupabase} | ${remoteCocheraId} | ${clasificacion}`);
    }

    let exactMatch = 0;
    for (const sub of withCocheraId) {
        const remote = remoteSubs.find(r => r.id === sub.id);
        if (remote && remote.cochera_id === (sub as any).cocheraId) {
            exactMatch++;
        }
    }

    console.log(`\n--- Resumen ---`);
    console.log(`17/17 coinciden: ${exactMatch === 17 ? 'SI' : 'NO (' + exactMatch + ')'}`);

    const stmt = dbInstance.prepare("SELECT status FROM outbox_events WHERE entity_type = 'subscriptions'");
    const outboxRows = stmt.all();
    
    const blocked = outboxRows.filter((o: any) => o.status === 'BLOCKED').length;
    const pending = outboxRows.filter((o: any) => o.status === 'PENDING' || o.status === 'RETRY').length;

    console.log(`Outbox BLOCKED: ${blocked}`);
    console.log(`Outbox PENDING/RETRY: ${pending}`);
}

run();
