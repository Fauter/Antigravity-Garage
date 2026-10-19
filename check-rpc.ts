import { supabase } from './src/infrastructure/lib/supabase';

async function run() {
    const { data, error } = await supabase.rpc('execute_sql', { sql: `SELECT prosrc FROM pg_proc WHERE proname = 'allocate_ticket_block';` });
    if (error) {
        console.error("RPC failed:", error);
    } else {
        console.log(data);
    }
}
run();
