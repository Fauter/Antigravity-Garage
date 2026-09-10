const fs = require('fs');
const content = fs.readFileSync('src/modules/AccessControl/domain/AccessManager.ts', 'utf-8');

const replacement = `        const priceRepo = {
            getPrices: async (method: string) => {
                const listFilter = (method === 'EFECTIVO') ? 'standard' : 'electronic';
                const prices = await db.prices.find({ garageId: finalGarageId, priceList: listFilter });
                const schemas = await db.vehicleTypes.find({ garageId: finalGarageId });
                const tariffs = await db.tariffs.find({ garageId: finalGarageId });

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
                    }
                });
                return matrix;
            }
        };

        const configRepo = new (require('../../Configuration/infra/ConfigRepository').ConfigRepository)();
        const tariffRepo = { getAll: () => configRepo.getTariffs(finalGarageId) };
        const paramRepo = { getParams: () => configRepo.getParams(finalGarageId) };

        const engine = new PricingEngine(tariffRepo as any, paramRepo as any, priceRepo);

        let price = 0;
        let notes = '';

        const closedStay: any = {
            ...stay,
            active: false,
            exitTime: exitDate,
            garageId: finalGarageId
        };

        if (!closedStay.ownerId && ownerId) {
            closedStay.ownerId = ownerId;
        } else if (closedStay.ownerId === null) {
            delete closedStay.ownerId;
        }`;

const newContent = content.replace(/        const priceRepo = \{[\s\S]*?            delete closedStay\.ownerId;\n        \}/, replacement);
fs.writeFileSync('src/modules/AccessControl/domain/AccessManager.ts', newContent);
console.log('Fixed processExit');
