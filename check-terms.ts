import { supabase } from './src/infrastructure/lib/supabase';

async function run() {
    const { data, error } = await supabase.from('terminals').select('*').eq('garage_id', '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02');
    console.log("Terminals:", data, error);
}
run();
