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

// Response Interceptor
api.interceptors.response.use(
    response => response,
    error => {
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);

export const resetDatabase = () => api.post('/config/reset');
