import { AxiosError } from 'axios';

/**
 * Extract user-friendly error message from Axios error or generic error.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof AxiosError) {
        const data = error.response?.data;
        const status = error.response?.status;
        // 5xx 先用调用方写好的兜底文案:后端 500 信封里的 message 往往是「服务器内部错误」这类无信息量文案。
        // 调用方没写兜底文案时才退回服务端原文,避免丢掉具体错误。
        if (status && status >= 500) {
            return fallback || data?.message || '服务端异常，请稍后重试';
        }
        if (data?.message) return data.message;
        if (status === 401) return '登录已过期，请重新登录';
        if (status === 403) return '无权限执行此操作';
        if (status === 429) return '请求过于频繁，请稍后再试';
        if (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout')) {
            return '请求超时，请稍后重试';
        }
        if (!error.response) return '网络连接失败，请检查网络';
    }
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: string }).message;
        if (message && !message.startsWith('Request failed with status code')) return message;
    }
    return fallback;
}
