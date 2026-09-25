import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthContext } from '../hooks/useAuthContext';
import { getAuthContext, selectGroupContext } from '../api/auth';
import { useAuthStore } from './auth';
import request from './request';

const group = { id: 1, name: 'Alpha', description: '', role: 'DEVELOPER' };
const context = { user: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' }, currentGroup: group, accessibleGroups: [group], systemAdmin: false, permissions: ['datasource.write'] };
function forbidden(config: InternalAxiosRequestConfig, status = 403) {
    return new AxiosError('Forbidden', undefined, config, undefined, { status, statusText: 'Forbidden', data: {}, headers: {}, config });
}
function success(config: InternalAxiosRequestConfig) {
    return { data: { code: 200, data: { ...context, permissions: [] } }, status: 200, statusText: 'OK', headers: {}, config };
}
let client: QueryClient;
const originalAdapter = request.defaults.adapter;
beforeEach(() => {
    useAuthStore.getState().setToken('token');
    useAuthStore.getState().setAuthContext(context);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); request.defaults.adapter = originalAdapter; vi.restoreAllMocks(); });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

describe('permission failure refresh', () => {
    it('refreshes once for concurrent 403s without logging out or replaying the failed operations', async () => {
        const calls: InternalAxiosRequestConfig[] = [];
        let complete!: () => void;
        request.defaults.adapter = vi.fn(async (config) => {
            calls.push(config);
            if (!config.url?.includes('/auth/context')) throw forbidden(config);
            if (calls.filter((item) => item.url?.includes('/auth/context')).length === 1) return success(config);
            await new Promise<void>((resolve) => { complete = resolve; });
            return success(config);
        });
        renderHook(() => useAuthContext(), { wrapper });
        await waitFor(() => expect(useAuthStore.getState().permissions).toEqual([]));
        await act(async () => { await Promise.allSettled([request.get('/api/v1/datasources'), request.get('/api/v1/offline/tree')]); });
        await waitFor(() => expect(calls.filter((item) => item.url?.includes('/auth/context'))).toHaveLength(2));
        await act(async () => { complete(); });
        expect(calls).toHaveLength(4);
        expect(useAuthStore.getState().token).toBe('token');
    });

    it('does not recursively refresh a rejected context request', async () => {
        const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => { throw forbidden(config); });
        request.defaults.adapter = adapter;
        renderHook(() => useAuthContext(), { wrapper });
        await waitFor(() => expect(useAuthStore.getState().currentGroup).toBeNull());
        await waitFor(() => expect(adapter).toHaveBeenCalledTimes(2));
        expect(useAuthStore.getState().token).toBe('token');
    });

    it.each([401, 403])('ignores a late %s from a previous session', async (status) => {
        let fail!: () => void;
        request.defaults.adapter = async (config) => {
            await new Promise<void>((resolve) => { fail = resolve; });
            throw forbidden(config, status);
        };
        const old = request.get('/api/v1/datasources').catch(() => undefined);
        await waitFor(() => expect(fail).toBeDefined());
        useAuthStore.getState().clearAuth();
        useAuthStore.getState().setToken('token');
        fail();
        await old;
        expect(useAuthStore.getState().token).toBe('token');
        expect(useAuthStore.getState().contextLoaded).toBe(false);
    });

    it('does not refresh the new group for a late forbidden response from the previous group', async () => {
        const dispatch = vi.spyOn(window, 'dispatchEvent');
        let fail!: () => void;
        request.defaults.adapter = async (config) => {
            await new Promise<void>((resolve) => { fail = resolve; });
            throw forbidden(config);
        };
        const old = request.get('/api/v1/datasources').catch(() => undefined);
        await waitFor(() => expect(fail).toBeDefined());
        useAuthStore.setState({ currentGroup: { ...group, id: 2 } });
        fail();
        await old;
        expect(dispatch).not.toHaveBeenCalled();
        expect(useAuthStore.getState().token).toBe('token');
    });

    it('keeps automatic GET and explicit POST context endpoints distinct', async () => {
        const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => success(config));
        request.defaults.adapter = adapter;
        await getAuthContext(1);
        await selectGroupContext(2);
        expect(adapter.mock.calls[0][0]).toMatchObject({ method: 'get', params: { groupId: 1 } });
        expect(adapter.mock.calls[1][0]).toMatchObject({ method: 'post', params: { groupId: 2 } });
    });
});
