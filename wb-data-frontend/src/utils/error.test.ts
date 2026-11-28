import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { getErrorMessage } from './error';

describe('getErrorMessage', () => {
    it('returns timeout hint when AxiosError has ECONNABORTED code', () => {
        const error = new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED');

        expect(getErrorMessage(error, '操作失败')).toBe('请求超时，请稍后重试');
    });

    it('returns timeout hint when AxiosError has timeout message without response', () => {
        const error = new AxiosError('Timeout of 90000ms exceeded');

        expect(getErrorMessage(error, '操作失败')).toBe('请求超时，请稍后重试');
    });

    it('returns network error hint when AxiosError has no response and is not a timeout', () => {
        const error = new AxiosError('Network Error', 'ERR_NETWORK');

        expect(getErrorMessage(error, '操作失败')).toBe('网络连接失败，请检查网络');
    });

    it('prefers server message when response payload provides one', () => {
        const response = {
            data: { message: '远端分支已更新，请先拉取' },
            status: 409,
            statusText: 'Conflict',
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() },
        } as AxiosResponse;
        const error = new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, response);

        expect(getErrorMessage(error, '操作失败')).toBe('远端分支已更新，请先拉取');
    });

    it('uses the written fallback for 5xx even when the server sends a message', () => {
        const response = {
            data: { code: 500, message: '服务器内部错误' },
            status: 500,
            statusText: 'Internal Server Error',
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() },
        } as AxiosResponse;
        const error = new AxiosError('Internal Server Error', 'ERR_BAD_RESPONSE', undefined, undefined, response);

        expect(getErrorMessage(error, '登录失败，请稍后重试')).toBe('登录失败，请稍后重试');
    });

    it('keeps the server message for 5xx when the caller passed no fallback', () => {
        const response = {
            data: { code: 500, message: '数据源连接失败: Connection refused' },
            status: 500,
            statusText: 'Internal Server Error',
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() },
        } as AxiosResponse;
        const error = new AxiosError('Internal Server Error', 'ERR_BAD_RESPONSE', undefined, undefined, response);

        expect(getErrorMessage(error, '')).toBe('数据源连接失败: Connection refused');
    });
});
