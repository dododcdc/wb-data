import { lazy } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthContext } from '../api/auth';
import type { AuthContextResponse } from '../types/auth';
import { useAuthStore } from '../utils/auth';
import { AuthGuard, withRouteSuspense } from './AuthGuard';

vi.mock('../api/auth', () => ({
    getAuthContext: vi.fn(),
    selectGroupContext: vi.fn(),
}));

const group = { id: 1, name: 'Alpha', role: 'GROUP_ADMIN', description: '' };
const context: AuthContextResponse = {
    user: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
    systemAdmin: false, currentGroup: group, accessibleGroups: [group], permissions: ['member.manage'],
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function Workspace() {
    const permissions = useAuthStore((s) => s.permissions);
    return <div>workspace {permissions.includes('member.manage') && <button>管理成员</button>}</div>;
}

let client: QueryClient;
function renderGuard() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <Routes>
                    <Route path="/login" element={<div>login</div>} />
                    <Route element={<AuthGuard />}>
                        <Route index element={<Workspace />} />
                    </Route>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('AuthGuard', () => {
    beforeEach(() => {
        useAuthStore.getState().clearAuth();
        useAuthStore.getState().setToken('token');
        vi.mocked(getAuthContext).mockReset().mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
        cleanup();
        client?.clear();
        focusManager.setFocused(undefined);
        vi.useRealTimers();
    });

    it('does not show a full-page loading card while auth context is pending', () => {
        renderGuard();
        expect(screen.queryByText('页面加载中')).toBeNull();
        expect(screen.queryByText('正在按需加载当前页面资源')).toBeNull();
        expect(screen.queryByText('workspace')).toBeNull();
    });

    it('refreshes already loaded permissions on mount without hiding the workspace', async () => {
        useAuthStore.getState().setAuthContext(context);
        vi.mocked(getAuthContext).mockResolvedValue({ ...context, permissions: [] });
        renderGuard();
        expect(screen.getByText('workspace')).toBeTruthy();
        await waitFor(() => expect(screen.queryByRole('button', { name: '管理成员' })).toBeNull());
        expect(getAuthContext).toHaveBeenCalled();
    });

    it('refreshes on window reactivation and periodically in the background', async () => {
        useAuthStore.getState().setAuthContext(context);
        vi.mocked(getAuthContext).mockResolvedValue(context);
        renderGuard();
        await waitFor(() => expect(getAuthContext).toHaveBeenCalledTimes(1));
        await act(async () => { fireEvent.focus(window); });
        await waitFor(() => expect(getAuthContext).toHaveBeenCalledTimes(2));
        vi.useFakeTimers();
        // Re-render the observer under fake timers so its interval is controlled.
        cleanup();
        client.clear();
        renderGuard();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        const count = vi.mocked(getAuthContext).mock.calls.length;
        focusManager.setFocused(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(vi.mocked(getAuthContext).mock.calls.length).toBeGreaterThan(count);
    });

    it.each(['new-token', 'token'])('ignores a previous login session response when the next token is %s', async (token) => {
        const old = deferred<AuthContextResponse>();
        vi.mocked(getAuthContext).mockReturnValueOnce(old.promise).mockResolvedValue({ ...context, permissions: [] });
        renderGuard();
        await waitFor(() => expect(getAuthContext).toHaveBeenCalledTimes(1));
        act(() => {
            useAuthStore.getState().clearAuth();
            useAuthStore.getState().setToken(token);
        });
        await waitFor(() => expect(useAuthStore.getState().contextLoaded).toBe(true));
        await act(async () => { old.resolve(context); });
        expect(useAuthStore.getState().permissions).toEqual([]);
        expect(useAuthStore.getState().token).toBe(token);
    });

    it.each([null, { ...group, id: 2, name: 'Beta' }])('clears a removed group and accepts the server fallback %j without logging out', async (fallback) => {
        useAuthStore.getState().setAuthContext(context);
        const forbidden = new AxiosError('Forbidden');
        forbidden.response = { status: 403 } as AxiosError['response'];
        const next = deferred<AuthContextResponse>();
        vi.mocked(getAuthContext).mockRejectedValueOnce(forbidden).mockReturnValue(next.promise);
        renderGuard();
        await waitFor(() => expect(useAuthStore.getState().currentGroup).toBeNull());
        expect(useAuthStore.getState().permissions).toEqual([]);
        expect(useAuthStore.getState().token).toBe('token');
        await act(async () => {
            next.resolve({ ...context, currentGroup: fallback, accessibleGroups: fallback ? [fallback] : [], permissions: [] });
        });
        await waitFor(() => expect(useAuthStore.getState().currentGroup).toEqual(fallback));
        expect(screen.queryByText('login')).toBeNull();
    });

    it('offers retry without logging out when the initial context request is forbidden', async () => {
        const forbidden = new AxiosError('Forbidden');
        forbidden.response = { status: 403 } as AxiosError['response'];
        vi.mocked(getAuthContext).mockRejectedValueOnce(forbidden).mockResolvedValue(context);
        renderGuard();
        fireEvent.click(await screen.findByRole('button', { name: '重试' }));
        await screen.findByText('workspace');
        expect(useAuthStore.getState().token).toBe('token');
    });
});

describe('withRouteSuspense', () => {
    afterEach(cleanup);
    it('does not fall back to a full-page loading card', () => {
        const Never = lazy(() => new Promise<{ default: () => null }>(() => {}));
        render(withRouteSuspense(<Never />));
        expect(screen.queryByText('页面加载中')).toBeNull();
        expect(screen.queryByText('正在按需加载当前页面资源')).toBeNull();
    });
});
