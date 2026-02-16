
import { supabase } from '../../../infrastructure/lib/supabase';
import { SyncService } from '../application/SyncService';
import { Mutation } from '../../../shared/schemas';
import { v4 as uuidv4 } from 'uuid';

const TEST_GARAGE_ID = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';

(async () => {
    console.log('🧪 Starting Manual Sync Verification...');

    // 1. Check Connection
    const { data, error } = await supabase.from('vehicles').select('count').limit(1);
    if (error) {
        console.error('❌ Supabase Connection Failed:', error.message);
        process.exit(1);
    }
    console.log('✅ Supabase Connection OK');

    // 2. Test Bootstrap
    console.log('🔄 Testing Bootstrap (pullAllData)...');
    const syncService = new SyncService();
    await syncService.pullAllData(TEST_GARAGE_ID);
    console.log('✅ Bootstrap executed (check logs for details)');

    // 3. Test Mutation Push
    console.log('🔄 Testing Mutation Push...');
    const testMutation: Mutation = {
        id: uuidv4(),
        entityType: 'Vehicle',
        entityId: uuidv4(),
        operation: 'CREATE',
        payload: {
            plate: 'TEST-999',
            type: 'Auto',
            brand: 'TestBrand',
            model: 'TestModel',
            garageId: TEST_GARAGE_ID
        },
        timestamp: new Date(),
        synced: false,
        retryCount: 0
    };

    const result = await syncService.processMutations([testMutation]);
    console.log('✅ Mutation Process Result:', result);

    console.log('🏁 Verification Complete.');
})();
