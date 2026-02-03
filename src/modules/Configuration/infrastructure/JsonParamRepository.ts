import fs from 'fs/promises';
import path from 'path';
import { IParamRepository, SystemParams } from '../domain/ParamRepository';

const DATA_PATH = path.join(process.cwd(), 'src', 'backend', 'data', 'parametros.json');

export class JsonParamRepository implements IParamRepository {
    private async readData(): Promise<SystemParams> {
        try {
            const data = await fs.readFile(DATA_PATH, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            // Default params if file missing
            return {
                fraccionarDesde: 0,
                toleranciaInicial: 15,
                recargoDia11: 10,
                recargoDia22: 20,
                permitirCobroAnticipado: false
            };
        }
    }

    async getParams(): Promise<SystemParams> {
        return this.readData();
    }

    async saveParams(params: Partial<SystemParams>): Promise<void> {
        const current = await this.readData();
        const updated = { ...current, ...params };
        await fs.writeFile(DATA_PATH, JSON.stringify(updated, null, 2));
    }
}
