import { SQLiteManager } from '../infrastructure/database/sqlite/SQLiteManager';
import { SubscriptionRepository } from '../modules/Garage/infra/SubscriptionRepository';
import { supabase } from '../infrastructure/lib/supabase';
import { SqliteSyncCoordinator } from '../modules/Sync/application/SqliteSyncCoordinator';

async function run() {
    process.env.STORAGE_ENGINE = 'SQLITE';
    const dbInstance = SQLiteManager.getInstance().getDatabase();
    
    const subRepo = new SubscriptionRepository();
    const localSubs = await subRepo.findAll();
    
    const withCocheraId = localSubs.filter((s: any) => s.cocheraId != null);
    const withoutCocheraId = localSubs.filter((s: any) => s.cocheraId == null);
    
    console.log(`Local Subs: ${localSubs.length} total. With cocheraId: ${withCocheraId.length}. Without: ${withoutCocheraId.length}`);

    const { data: remoteSubs, error } = await supabase.from('subscriptions').select('id, cochera_id');
    if (error) {
        console.error('Error fetching remote subs:', error);
        return;
    }

    let remoteWithIdAntes = 0;
    let updatesSent = 0;

    for (const sub of withCocheraId) {
        const remote = remoteSubs.find(r => r.id === sub.id);
        const localCocheraId = (sub as any).cocheraId;
        
        if (remote) {
            if (remote.cochera_id === localCocheraId) {
                remoteWithIdAntes++;
            } else if (remote.cochera_id == null) {
                console.log(`Remote cochera_id is null for sub ${sub.id}. Re-triggering UPDATE...`);
                await subRepo.save(sub);
                updatesSent++;
            } else {
                console.log(`MISMATCH for sub ${sub.id}: local ${localCocheraId} vs remote ${remote.cochera_id}`);
            }
        } else {
            console.log(`Sub ${sub.id} not found in Supabase!`);
        }
    }

    console.log(`Remote with cochera_id antes: ${remoteWithIdAntes}`);
    console.log(`Updates sent: ${updatesSent}`);

    if (updatesSent > 0) {
        console.log('Running SqliteSyncCoordinator to process outbox...');
        const syncCoordinator = new SqliteSyncCoordinator();
        await syncCoordinator.processOutbox();
        console.log('Outbox sync complete. Waiting 2 seconds for propagation...');
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Verify again
    const { data: remoteSubsAfter, error: errAfter } = await supabase.from('subscriptions').select('id, cochera_id');
    if (errAfter) return console.error(errAfter);

    let exactMatch = 0;
    for (const sub of withCocheraId) {
        const remote = remoteSubsAfter.find(r => r.id === sub.id);
        if (remote && remote.cochera_id === (sub as any).cocheraId) {
            exactMatch++;
        }
    }

    let noMatchNull = 0;
    for (const sub of withoutCocheraId) {
        const remote = remoteSubsAfter.find(r => r.id === sub.id);
        if (remote && remote.cochera_id == null) {
            noMatchNull++;
        }
    }

    console.log(`Remote EXACT coincidentes: ${exactMatch}`);
    console.log(`Remote NO_MATCH null: ${noMatchNull}`);

    // Check Outbox directly with SQLite
    const stmt = dbInstance.prepare("SELECT status FROM outbox_events WHERE entity_type = 'subscriptions'");
    const outboxRows = stmt.all();
    
    const blocked = outboxRows.filter((o: any) => o.status === 'BLOCKED').length;
    const pending = outboxRows.filter((o: any) => o.status === 'PENDING' || o.status === 'RETRY').length;

    console.log(`Outbox BLOCKED: ${blocked}`);
    console.log(`Outbox PENDING/RETRY: ${pending}`);
}

run();
