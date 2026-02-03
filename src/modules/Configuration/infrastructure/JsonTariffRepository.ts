import fs from 'fs/promises';
import path from 'path';
import { ITariffRepository, Tariff } from '../domain/TariffRepository';
import { v4 as uuidv4 } from 'uuid';

const DATA_PATH = path.join(process.cwd(), 'src', 'backend', 'data', 'tarifas.json');

export class JsonTariffRepository implements ITariffRepository {
    private async readData(): Promise<Tariff[]> {
        try {
            const data = await fs.readFile(DATA_PATH, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    private async writeData(data: Tariff[]): Promise<void> {
        await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2));
    }

    async getAll(): Promise<Tariff[]> {
        return this.readData();
    }

    async save(tariff: Tariff): Promise<void> {
        const data = await this.readData();
        if (!tariff.id) tariff.id = uuidv4();
        data.push(tariff);
        await this.writeData(data);
    }

    async update(id: string, tariff: Partial<Tariff>): Promise<void> {
        const data = await this.readData();
        const index = data.findIndex(t => t.id === id);
        if (index !== -1) {
            data[index] = { ...data[index], ...tariff };
            await this.writeData(data);
        }
    }

    async delete(id: string): Promise<void> {
        const data = await this.readData();
        const filtered = data.filter(t => t.id !== id);
        await this.writeData(filtered);
    }
}
