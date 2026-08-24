import { createClient } from '@supabase/supabase-js';
import Datastore from 'nedb-promises';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

const localDbPath = path.join(process.cwd(), '.data', 'stays.db');
const staysDb = Datastore.create({ filename: localDbPath, autoload: true });

async function main() {
    const args = process.argv.slice(2);
    const isApply = args.includes('--apply');
    const plateIdx = args.findIndex(a => a === '--plate');
    const plateFilter = plateIdx >= 0 ? args[plateIdx + 1] : null;

    console.log(`\n🔍 [Repair] Iniciando script de reparación de Stays...`);
    console.log(`[Repair] Modo: ${isApply ? 'APLICAR CAMBIOS (Peligro)' : 'DRY RUN (Solo lectura)'}`);

    let localQuery: any = { active: true };
    if (plateFilter) {
        localQuery.plate = plateFilter;
    }

    const localStays = await staysDb.find(localQuery);
    console.log(`\n[Repair] Encontradas ${localStays.length} estadías locales activas${plateFilter ? ` para ${plateFilter}` : ''}.`);

    for (const localStay of localStays) {
        const { data: remoteStays, error } = await supabase
            .from('stays')
            .select('id, plate, active')
            .eq('plate', localStay.plate)
            .eq('active', true);

        if (error) {
            console.error(`[Repair] Error consultando Supabase para ${localStay.plate}:`, error.message);
            continue;
        }

        const exactMatch = remoteStays?.find(s => s.id === localStay.id);
        const equivalentMatch = remoteStays?.find(s => s.id !== localStay.id && s.plate === localStay.plate && s.active);

        if (!exactMatch) {
            console.log(`\n⚠️ [Repair] Discrepancia detectada para ${localStay.plate} (Local ID: ${localStay.id})`);
            
            if (equivalentMatch) {
                console.log(`   -> Ya existe otra estadía remota activa para esta patente (Remote ID: ${equivalentMatch.id}). No se duplicará.`);
            } else {
                console.log(`   -> Estadía remota NO existe. Local es válida.`);
                
                // Mapear al schema remoto
                const payload = {
                    id: localStay.id,
                    garage_id: localStay.garageId || localStay.garage_id,
                    plate: localStay.plate,
                    vehicle_type: localStay.vehicleType || localStay.vehicle_type || 'Auto',
                    vehicle_id: localStay.vehicleId || localStay.vehicle_id,
                    active: localStay.active,
                    is_subscriber: localStay.isSubscriber || false,
                    subscription_id: localStay.subscriptionId || localStay.subscription_id || null,
                    ticket_code: localStay.ticket_code || null,
                    entry_time: localStay.entryTime ? new Date(localStay.entryTime).toISOString() : null,
                    exit_time: localStay.exitTime ? new Date(localStay.exitTime).toISOString() : null,
                    is_prepaid: Boolean(localStay.isPrepaid || localStay.is_prepaid),
                    prepaid_until: localStay.prepaidUntil || localStay.prepaid_until ? new Date(localStay.prepaidUntil || localStay.prepaid_until).toISOString() : null,
                    prepaid_tariff_id: localStay.prepaidTariffId || localStay.prepaid_tariff_id || null,
                    prepaid_amount: typeof localStay.prepaidAmount === 'number' ? localStay.prepaidAmount : (typeof localStay.prepaid_amount === 'number' ? localStay.prepaid_amount : null),
                    prepaid_movement_id: localStay.prepaidMovementId || localStay.prepaid_movement_id || null,
                    exit_authorized: localStay.exit_authorized ?? false,
                    exit_authorized_at: localStay.exit_authorized_at ? new Date(localStay.exit_authorized_at).toISOString() : null,
                    updated_at: new Date().toISOString()
                };

                if (isApply) {
                    const { error: upsertError } = await supabase.from('stays').upsert(payload);
                    if (upsertError) {
                        console.error(`   ❌ [Repair] Error insertando en Supabase:`, upsertError.message);
                    } else {
                        console.log(`   ✅ [Repair] Estadía sincronizada forzosamente en Supabase.`);
                    }
                } else {
                    console.log(`   ℹ️ [Repair] DRY RUN: Se insertaría el siguiente payload:`, payload);
                }
            }
        } else {
            console.log(`✅ [Repair] ${localStay.plate} (ID: ${localStay.id}) sincronizada correctamente.`);
        }
    }
}

main().catch(console.error);
