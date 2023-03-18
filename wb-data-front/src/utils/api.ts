import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8080/'
    ,timeout: 10000
});

export const get = (url: string, config?: any) => {
    return api.get(url, config)
        .then(response => response.data);
};

export const post = (url: string, data: any, config?: any) => {
    return api.post(url, data, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => response.data);
};

export const put = (url: string, data: any, config?: any) => {
    return api.put(url, data, config)
        .then(response => response.data);
};

export const del = (url: string, config?: any) => {
    return api.delete(url, config)
        .then(response => response.data);
};