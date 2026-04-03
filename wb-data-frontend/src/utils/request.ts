import axios from 'axios';
import { getToken, useAuthStore } from './auth';

const request = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    timeout: 10000,
});

request.interceptors.request.use(
    (config) => {
        const token = getToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

request.interceptors.response.use(
    (response) => {
        const res = response.data;
        if (res.code === 200 || res.code === 0 || res.success) {
            return res.data;
        }
        return Promise.reject(new Error(res.message || 'Error occurred'));
    },
    (error) => {
        if (error.response?.status === 401) {
            useAuthStore.getState().clearAuth();
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default request;
