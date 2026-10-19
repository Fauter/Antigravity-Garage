import { db } from './src/infrastructure/database/datastore';

async function run() {
    const finalGarageId = '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02';
    const method = 'ELECTRONIC';
    const listFilter = 'electronic';

    const prices: any[] = await db.prices.find({ garageId: finalGarageId, priceList: listFilter });
    const schemas: any[] = await db.vehicleTypes.find({ garageId: finalGarageId });
    const tariffs: any[] = await db.tariffs.find({ garageId: finalGarageId });

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
