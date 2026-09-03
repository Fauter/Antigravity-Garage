import axios from 'axios';

export const api = axios.create({
    baseURL: 'http://localhost:3000/api',
    headers: {
        'Content-Type': 'application/json'
    }
});

// Request Interceptor: Inject Tenant ID (Offline-First Strategy)
api.interceptors.request.use((config) => {
    try {
        const storedConfig = localStorage.getItem('ag_terminal_config');
        if (storedConfig) {
            const parsed = JSON.parse(storedConfig);
            if (parsed.garage_id) {
                config.headers['x-garage-id'] = parsed.garage_id;
            }
        }
    } catch (e) {
        console.warn('Error reading terminal config for headers', e);
    }
    return config;
});

api.interceptors.response.use(
    response => response,
    error => {
        if (axios.isCancel(error) || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
            return Promise.reject(error);
        }
        if (import.meta.env.DEV) {
            console.error('[FRONTEND:HTTP-ERROR]', {
                method: error.config?.method?.toUpperCase(),
                url: error.config?.url,
                status: error.response?.status,
                statusText: error.response?.statusText,
                message: error.message,
                data: error.response?.data ? String(error.response.data).substring(0, 200) : null
            });
        }
        return Promise.reject(error);
    }
);

export const resetDatabase = () => api.post('/config/reset');
