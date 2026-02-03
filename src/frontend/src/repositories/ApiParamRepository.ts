import { api } from '../services/api';

export class ApiParamRepository {
    async getParams() {
        const { data } = await api.get('/parametros');
        return data;
    }
}
