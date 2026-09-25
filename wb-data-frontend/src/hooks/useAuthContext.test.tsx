import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthContext, selectGroupContext } from '../api/auth';
import type { AuthContextResponse } from '../types/auth';
import { useAuthStore } from '../utils/auth';
import { selectAuthGroup, useAuthContext } from './useAuthContext';

vi.mock('../api/auth', () => ({ getAuthContext: vi.fn(), selectGroupContext: vi.fn() }));
const group = { id: 1, name: 'Alpha', description: '', role: 'GROUP_ADMIN' };
const context: AuthContextResponse = {
    user: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
    systemAdmin: false, currentGroup: group, accessibleGroups: [group], permissions: ['member.manage'],
};
const beta = { ...context, currentGroup: { ...group, id: 2, name: 'Beta' }, permissions: [] };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
let client: QueryClient;
beforeEach(() => {
    vi.resetAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useAuthStore.getState().setToken('token');
    useAuthStore.getState().setAuthContext(context);
});
afterEach(() => { cleanup(); client.clear(); });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

describe('auth context coordination', () => {
    it('falls back to an accessible group when an administrator receives 404 for the current group', async () => {
        useAuthStore.getState().setAuthContext({ ...context, systemAdmin: true });
        vi.mocked(getAuthContext)
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 404 } })
            .mockResolvedValue({ ...beta, systemAdmin: true });

        renderHook(() => useAuthContext(), { wrapper });

        await waitFor(() => expect(useAuthStore.getState().currentGroup?.id).toBe(2));
        expect(getAuthContext).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
        expect(useAuthStore.getState().systemAdmin).toBe(true);
        expect(useAuthStore.getState().token).toBe('token');
    });

    it('uses POST for selection and ignores an earlier background GET', async () => {
        const old = deferred<AuthContextResponse>();
        vi.mocked(getAuthContext).mockReturnValueOnce(old.promise).mockResolvedValue(beta);
        vi.mocked(selectGroupContext).mockResolvedValue(beta);
        renderHook(() => useAuthContext(), { wrapper });
        await waitFor(() => expect(getAuthContext).toHaveBeenCalledTimes(1));
        await act(async () => { await selectAuthGroup(client, 2); });
        await act(async () => { old.resolve(context); });
        expect(selectGroupContext).toHaveBeenCalledWith(2);
        expect(useAuthStore.getState().currentGroup?.id).toBe(2);
        expect(useAuthStore.getState().permissions).toEqual([]);
    });

    it('ignores an older selection after a newer selection completes', async () => {
        const old = deferred<AuthContextResponse>();
        vi.mocked(selectGroupContext).mockReturnValueOnce(old.promise).mockResolvedValue(beta);
        const first = selectAuthGroup(client, 3);
        const second = selectAuthGroup(client, 2);
        await second;
        old.resolve({ ...context, currentGroup: { ...group, id: 3 } });
        await first;
        expect(useAuthStore.getState().currentGroup?.id).toBe(2);
    });

    it.each(['new-token', 'token'])('ignores a selection from the previous login session (%s)', async (token) => {
        const old = deferred<AuthContextResponse>();
        vi.mocked(selectGroupContext).mockReturnValue(old.promise);
        const selection = selectAuthGroup(client, 2);
        useAuthStore.getState().clearAuth();
        useAuthStore.getState().setToken(token);
        old.resolve(beta);
        await selection;
        expect(useAuthStore.getState().currentGroup).toBeNull();
        expect(useAuthStore.getState().contextLoaded).toBe(false);
    });

    it('preserves the original context and rejects when switching fails', async () => {
        vi.mocked(selectGroupContext).mockRejectedValue(new Error('denied'));
        await expect(selectAuthGroup(client, 2)).rejects.toThrow('denied');
        expect(useAuthStore.getState().currentGroup).toEqual(group);
        expect(useAuthStore.getState().permissions).toEqual(context.permissions);
    });
});
