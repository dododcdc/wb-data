import { AxiosError } from 'axios';

/**
 * Extract user-friendly error message from Axios error or generic error.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof AxiosError) {
        const data = error.response?.data;
        if (data?.message) return data.message;
        if (error.response?.status === 401) return '登录已过期，请重新登录';
        if (error.response?.status === 403) return '无权限执行此操作';
        if (error.response?.status === 429) return '请求过于频繁，请稍后再试';
        if (!error.response) return '网络连接失败，请检查网络';
    }
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: string }).message;
        if (message) return message;
    }
    return fallback;
}
