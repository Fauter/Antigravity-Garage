import { SQLiteManager } from '../infrastructure/database/sqlite/SQLiteManager';
import { SubscriptionRepository } from '../modules/Garage/infra/SubscriptionRepository';
import { CocheraRepository } from '../modules/Garage/infra/CocheraRepository';
import { VehicleRepository } from '../modules/Garage/infra/VehicleRepository';

async function main() {
    process.env.STORAGE_ENGINE = 'SQLITE';
    const sqliteManager = SQLiteManager.getInstance();
    sqliteManager.getDatabase();

    const subRepo = new SubscriptionRepository();
    const cocheraRepo = new CocheraRepository();
    const vehicleRepo = new VehicleRepository();

    const subs = await subRepo.findAll();
    const cocheras = await cocheraRepo.findAll();
    const vehicles = await (vehicleRepo as any).getAll ? await (vehicleRepo as any).getAll() : [];

    let exact = 0;
    let ambiguous = 0;
    let noMatch = 0;
    
    console.log(`Total subscriptions: ${subs.length}`);

    for (const sub of subs) {
        if ((sub as any).cocheraId) {
            exact++; // Already has it
            continue;
        }

        const candidates = [];
        
        for (const cochera of cocheras) {
            const cocheraClientId = cochera.clienteId;
            const cocheraNumero = cochera.numero;
            const cocheraTipo = cochera.tipo ? cochera.tipo.toLowerCase().replace(/fija/g, 'fija').replace(/movil/g, 'movil').replace(/exclusiva/g, 'exclusiva') : '';

            const cleanCocheraPlates = (cochera.vehiculos || []).map((v: any) => typeof v === 'string' ? v.trim() : v.plate?.trim()).filter(Boolean);
            const cocheraVehicles = vehicles.filter((v: any) => v.plate && cleanCocheraPlates.includes(v.plate.trim()));
            const cocheraVehicleIds = cocheraVehicles.map((v: any) => String(v.id));

            const subClientId = sub.customerId;
            const subVehicleId = String(sub.vehicleId);
            const subPlate = (sub as any).vehicleData?.plate?.trim() || (sub as any).plate?.trim();
            const subSpotNumber = sub.spotNumber;
            const normSubType = sub.type ? sub.type.toLowerCase().replace(/fija/g, 'fija').replace(/movil/g, 'movil').replace(/exclusiva/g, 'exclusiva') : '';

            let matched = false;
            let matchType = '';

            if (subSpotNumber && cocheraNumero && String(subSpotNumber) === String(cocheraNumero) && subClientId === cocheraClientId) {
                matched = true;
                matchType = 'SPOT';
            } else if (subVehicleId && subVehicleId !== 'undefined' && subVehicleId !== 'null' && cocheraVehicleIds.includes(subVehicleId)) {
                matched = true;
                matchType = 'VEHICLE_ID';
            } else if (subPlate && cleanCocheraPlates.includes(subPlate)) {
                matched = true;
                matchType = 'PLATE';
            } else if (subClientId === cocheraClientId && normSubType === cocheraTipo) {
                matched = true;
                matchType = 'TYPE_FALLBACK';
            }

            if (matched) {
                candidates.push({ cochera, matchType });
            }
        }

        if (candidates.length === 1) {
            exact++;
            // console.log(`[EXACT] Sub ${sub.id} -> Cochera ${candidates[0].cochera.id} (${candidates[0].matchType})`);
        } else if (candidates.length > 1) {
            ambiguous++;
            console.log(`[AMBIGUOUS] Sub ${sub.id} matched ${candidates.length} cocheras.`);
        } else {
            noMatch++;
            console.log(`[NO_MATCH] Sub ${sub.id}`);
        }
    }

    console.log(`--- RESULTS ---`);
    console.log(`EXACT: ${exact}`);
    console.log(`AMBIGUOUS: ${ambiguous}`);
    console.log(`NO MATCH: ${noMatch}`);
}

main().catch(console.error);
