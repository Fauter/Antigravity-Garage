import { supabase } from './src/infrastructure/lib/supabase';
import dotenv from 'dotenv';
dotenv.config();

async function checkRemote() {
    const pc = await supabase.from('partial_closes').select('id').eq('id', 'f36e4278-e67f-48ee-8e35-cfdf86141f36').single();
    const mov = await supabase.from('movements').select('id').eq('id', '9df33cfe-37d3-47e6-8bea-a57c93787288').single();
    const sub = await supabase.from('subscriptions').select('id').eq('id', '1f14aae7-f3d9-4911-8685-1355a8efeda0').single();

    console.log('PartialClose exists:', !!pc.data, pc.error?.message || '');
    console.log('Movement exists:', !!mov.data, mov.error?.message || '');
    console.log('Subscription exists:', !!sub.data, sub.error?.message || '');
    process.exit(0);
}
checkRemote();
