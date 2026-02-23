import axios from 'axios';

const request = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    timeout: 10000,
});

request.interceptors.request.use(
    (config) => {
        // Add token or auth headers here if needed
        return config;
    },
    (error) => Promise.reject(error)
);

request.interceptors.response.use(
    (response) => {
        const res = response.data;
        if (res.code === 200 || res.code === 0 || res.success) {
            return res.data; // Unpack data if successful
        }
        // Handle specific application errors based on res.code here
        return Promise.reject(new Error(res.message || 'Error occurred'));
    },
    (error) => {
        console.error('Request error:', error);
        return Promise.reject(error);
    }
);

export default request;
