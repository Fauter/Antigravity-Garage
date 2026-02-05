import { Vehicle } from '../../../shared/schemas';
import { JsonDB } from '../../../infrastructure/database/json-db';

const vehicleDB = new JsonDB<Vehicle>('vehicles');

export class VehicleRepository {
    async save(vehicle: Vehicle): Promise<Vehicle> {
        // Validation: Ensure ID
        if (!vehicle.id) {
            throw new Error("Vehicle ID is required for save");
        }

        const existing = await vehicleDB.getById(vehicle.id);
        if (existing) {
            await vehicleDB.updateOne({ id: vehicle.id }, vehicle);
        } else {
            await vehicleDB.create(vehicle);
        }
        return vehicle;
    }

    async findById(id: string): Promise<Vehicle | null> {
        return await vehicleDB.getById(id);
    }

    async findByPlate(plate: string): Promise<Vehicle | null> {
        const all = await vehicleDB.getAll();
        return all.find(v => v.plate === plate) || null;
    }

    async reset(): Promise<void> {
        await vehicleDB.reset();
    }
}
