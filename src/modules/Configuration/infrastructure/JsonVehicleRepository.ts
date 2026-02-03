import fs from 'fs/promises';
import path from 'path';

export interface VehicleType {
    id: string;
    nombre: string;
}

const DATA_PATH = path.join(process.cwd(), 'src', 'backend', 'data', 'vehicleTypes.json');

export class JsonVehicleRepository {
    async getAll(): Promise<VehicleType[]> {
        try {
            const data = await fs.readFile(DATA_PATH, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    async add(type: VehicleType): Promise<void> {
        const types = await this.getAll();
        types.push(type);
        await this.save(types);
    }

    async delete(id: string): Promise<void> {
        let types = await this.getAll();
        types = types.filter(t => t.id !== id);
        await this.save(types);
    }

    private async save(types: VehicleType[]): Promise<void> {
        await fs.writeFile(DATA_PATH, JSON.stringify(types, null, 2));
    }
}
