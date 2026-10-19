import re

with open('src/modules/Garage/infra/GarageController.ts', 'r', encoding='utf-8') as f:
    content = f.read()

helper = '''
    private resolveVehicleTypeId = async (sub: any, garageId: string): Promise<string | null> => {
        try {
            const vehicleId = sub.vehicleId || sub.vehicle_id;
            let subPlate = sub.plate || sub.vehicleData?.plate;
            let vTypeString = sub.vehicleData?.type;

            if (vehicleId && !vTypeString) {
                const v = await (this.vehicleRepo as any).findById(vehicleId);
                if (v) {
                    vTypeString = v.type;
                    if (!subPlate) subPlate = v.plate;
                }
            } else if (subPlate && !vTypeString) {
                const v = await this.vehicleRepo.findByPlate(subPlate);
                if (v) vTypeString = v.type;
            }

            if (!vTypeString) return null;
            
            const vKey = String(vTypeString).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
            const vehicleTypes = await (new (require('../../Configuration/infra/SqliteConfigRepository').ConfigRepository)()).getVehicleTypes(garageId);
            
            const matchedVt = vehicleTypes.find((vt: any) => 
                String(vt.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() === vKey
            );
            
            return matchedVt ? matchedVt.id : null;
        } catch (err) {
            console.error("Error resolving vehicleTypeId:", err);
            return null;
        }
    };
'''

# insert helper before renewSubscription
content = content.replace('renewSubscription = async (req: Request, res: Response) => {', helper + '\n\n    renewSubscription = async (req: Request, res: Response) => {')

content = content.replace(
    'const previewReq = { subId, targetDebtIds, now: new Date(), config: garageSettings, basePrice };',
    '''const vehicleTypeId = await this.resolveVehicleTypeId(subscription, garageId);
            const previewReq = { subId, targetDebtIds, now: new Date(), config: garageSettings, basePrice, vehicleTypeId };'''
)

content = content.replace(
    '''const previewReq = {
                        subId,
                        targetDebtIds,
                        now: new Date(),
                        config: garageSettings,
                        basePrice
                    };''',
    '''const vehicleTypeId = await this.resolveVehicleTypeId(subToRenew, garageId);
                    const previewReq = {
                        subId,
                        targetDebtIds,
                        now: new Date(),
                        config: garageSettings,
                        basePrice,
                        vehicleTypeId
                    };'''
)

with open('src/modules/Garage/infra/GarageController.ts', 'w', encoding='utf-8') as f:
    f.write(content)
