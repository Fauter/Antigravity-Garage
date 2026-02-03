import fs from 'fs/promises';
import path from 'path';
import { IPriceMatrixRepository, PriceMatrix } from '../domain/PriceMatrixRepository';

const DATA_PATH = path.join(process.cwd(), 'src', 'backend', 'data', 'prices.json');

export class JsonPriceMatrixRepository implements IPriceMatrixRepository {
    private async readData(): Promise<{ efectivo: PriceMatrix; otros: PriceMatrix }> {
        try {
            const data = await fs.readFile(DATA_PATH, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            return { efectivo: {}, otros: {} };
        }
    }

    private async writeData(data: { efectivo: PriceMatrix; otros: PriceMatrix }): Promise<void> {
        await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2));
    }

    async getPrices(paymentMethod: 'efectivo' | 'otros'): Promise<PriceMatrix> {
        const data = await this.readData();
        return data[paymentMethod] || {};
    }

    async updatePrices(paymentMethod: 'efectivo' | 'otros', vehicleType: string, prices: { [tariffName: string]: number }): Promise<void> {
        const data = await this.readData();
        if (!data[paymentMethod]) data[paymentMethod] = {};

        // Merge or replace? The user requirement says "update". Usually we want to merge or set.
        // If we want to replace the whole object for that vehicle:
        // data[paymentMethod][vehicleType] = prices;
        // But maybe we want to merge? 
        // "nuevosPreciosVehiculo = { ...(precios[vehiculo] || {}), [tarifa]: valorNumerico };" from user code implies we send the WHOLE object for that vehicle.
        // So I will replace it.
        data[paymentMethod][vehicleType] = prices;

        await this.writeData(data);
    }
}
