import { api } from '../services/api';

export class ApiPriceMatrixRepository {
    async getPrices(paymentMethod: 'efectivo' | 'otros') {
        const { data } = await api.get(`/precios?metodo=${paymentMethod}`);
        return data;
    }
}
