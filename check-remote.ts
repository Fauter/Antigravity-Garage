import { supabase } from './src/infrastructure/lib/supabase';

async function run() {
    const { data: correlatives } = await supabase.from('garage_correlatives').select('*').eq('garage_id', '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02');
    console.log("garage_correlatives:", correlatives);

    const { data: rpcDef } = await supabase.rpc('get_function_definition', { func_name: 'allocate_ticket_block' }); // If it exists, otherwise we'll just check the db
    console.log("RPC Data:", rpcDef);
}
run();
