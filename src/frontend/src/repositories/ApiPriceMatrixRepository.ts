import { api } from '../services/api';

export class ApiPriceMatrixRepository {
    async getPrices(paymentMethod: 'efectivo' | 'otros') {
        const { data } = await api.get('/precios');
        return paymentMethod === 'efectivo' ? (data.standard || {}) : (data.electronic || {});
    }
}
