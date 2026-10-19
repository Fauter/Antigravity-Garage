import { ConfigRepository } from './src/modules/Configuration/infra/ConfigRepository';

async function run() {
    const finalGarageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';
    const method = 'Transferencia'; // electronic

    const configRepo = new ConfigRepository();

    const prices: any[] = await configRepo.getPrices(finalGarageId, method);
    const schemas: any[] = await configRepo.getVehicleTypes(finalGarageId);
    const tariffs: any[] = await configRepo.getTariffs(finalGarageId);

    console.log(`Prices count: ${prices.length}`);
    console.log(`Schemas count: ${schemas.length}`);
    console.log(`Tariffs count: ${tariffs.length}`);

    const matrix: any = {};
    const vMap = new Map(schemas.map((v: any) => [v.id, v.name]));
    const tMap = new Map(tariffs.map((t: any) => [t.id, t.name]));

    prices.forEach((p: any) => {
        const vId = p.vehicleTypeId || p.vehicle_type_id;
        const tId = p.tariffId || p.tariff_id;
        const vName = vMap.get(vId);
        const tName = tMap.get(tId);
        if (vName && tName) {
            if (!matrix[vName]) matrix[vName] = {};
            matrix[vName][tName] = Number(p.amount);
            console.log(`Setting matrix[${vName}][${tName}] = ${p.amount} (from price for vId=${vId})`);
        }
    });

    console.log(JSON.stringify(matrix, null, 2));
}

run().catch(console.error);
