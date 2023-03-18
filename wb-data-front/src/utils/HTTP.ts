import axios, { AxiosResponse } from 'axios';

type MethodType = 'get' | 'post';

interface CommonResponse<T> {
    code: string;
    message: string;
    data: T;
}

class Http {
    private static instance = axios.create({
        baseURL: 'http://localhost:8080/', // 配置 API 地址
        timeout: 5000,
    });

    public static get<T>(url: string, params?: object): Promise<CommonResponse<T> | null> {
        return this.instance
            .get(url, { params })
            .then((res: AxiosResponse<CommonResponse<T>>) => {
                if (res.data.code === "200") {
                    return res.data;
                } else {
                    return null;
                }
            })
            .catch((err) => {
                console.log(err);
                return null;
            });
    }

    public static post<T>(url: string, data: any, config?: any): Promise<CommonResponse<T> | null> {
        return this.instance
            .post(url, data,{
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then((res: AxiosResponse<CommonResponse<T>>) => {
                if (res.data.code === "200") {
                    return res.data;
                } else {
                    return null;
                }
            })
            .catch((err) => {
                console.log(err);
                return null;
            });
    }
}

export default Http;