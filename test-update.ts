import { supabase } from './src/infrastructure/lib/supabase';

async function run() {
    const { data, error } = await supabase.from('garage_correlatives').update({ last_value: 694 }).eq('garage_id', '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02').eq('correlative_type', 'movement').select();
    console.log("Update result:", data, error);
}
run();
