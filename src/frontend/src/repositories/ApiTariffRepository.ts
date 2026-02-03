import { api } from '../services/api';

// Interface duplication to avoid strict shared module dependency issues in Vite for now, 
// or import from relative path if possible. 
// Ideally we share types. Let's try to just return data.

export class ApiTariffRepository {
    async getAll() {
        const { data } = await api.get('/tarifas');
        return data;
    }

    // Config side only
    async save(tariff: any) {
        return api.post('/tarifas', tariff);
    }
}
