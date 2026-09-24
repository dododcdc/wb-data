import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Layout from './Layout';
import { useAuthStore } from '../../utils/auth';
import { logout } from '../../api/auth';
import { getOfflineRepoStatus, listBranches, switchBranch } from '../../api/offline';

const showFeedbackSpy = vi.fn();

vi.mock('../../components/loading/TopProgressBar', () => ({
    TopProgressBar: () => null,
}));

vi.mock('../../components/OperationFeedback', () => ({
    OperationFeedback: () => null,
}));

vi.mock('../../components/ui/tooltip', () => ({
    TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../router/routeModules', () => ({
    loadDashboardModule: vi.fn(),
    loadDataSourceListModule: vi.fn(),
    loadGroupListModule: vi.fn(),
    loadGroupSettingsModule: vi.fn(),
    loadOfflineWorkbenchModule: vi.fn(),
    loadOperationsCenterModule: vi.fn(),
    loadParameterGroupPageModule: vi.fn(),
    loadQueryModule: vi.fn(),
    loadUserListModule: vi.fn(),
}));

vi.mock('../../components/sql-editor/sqlEditorModule', () => ({
    loadSqlEditorModule: vi.fn(),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({
        showFeedback: showFeedbackSpy,
    }),
}));

vi.mock('../../api/auth', () => ({
    getAuthContext: vi.fn(),
    logout: vi.fn(),
}));

vi.mock('../../api/offline', () => ({
    getOfflineRepoStatus: vi.fn().mockResolvedValue({
        groupId: 4,
        repoPath: '/tmp/wb-data-4',
        exists: true,
        gitInitialized: true,
        dirty: false,
        ahead: false,
        hasRemote: true,
        hasUpstream: true,
        branch: 'feature/policy-etl',
        headCommitId: 'abc',
        headCommitMessage: 'init',
        headCommitAt: null,
    }),
    listBranches: vi.fn().mockResolvedValue({
        branches: [
            { name: 'feature/policy-etl', current: true, local: true, remote: false, remoteName: null, trackingBranch: null },
            { name: 'main', current: false, local: true, remote: true, remoteName: 'origin/main', trackingBranch: 'origin/main' },
        ],
    }),
    switchBranch: vi.fn(),
}));

function httpError(status: number) {
    return new AxiosError('Request failed', undefined, undefined, undefined, {
        status,
        statusText: 'Error',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
    });
}

describe('Layout', () => {
    beforeEach(() => {
        vi.mocked(logout).mockReset();
        useAuthStore.getState().setToken('token');
        useAuthStore.setState({
            token: 'token',
            userInfo: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
            systemAdmin: false,
            currentGroup: { id: 4, name: 'policy', description: '', role: 'GROUP_ADMIN' },
            accessibleGroups: [
                { id: 4, name: 'policy', description: '', role: 'GROUP_ADMIN' },
            ],
            permissions: ['offline.read', 'offline.write', 'group.settings'],
            contextLoaded: true,
        });
    });

    afterEach(() => {
        cleanup();
        useAuthStore.getState().clearAuth();
        vi.clearAllMocks();
    });

    function renderOfflineLayout() {
        const router = createMemoryRouter([
            {
                path: '/',
                element: <Layout />,
                children: [{ path: 'offline', element: <div>offline page</div> }],
            },
        ], { initialEntries: ['/offline'] });

        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
            </QueryClientProvider>,
        );
    }

    it('keeps the navbar context focused on project group switching', async () => {
        renderOfflineLayout();
        expect(await screen.findByText('policy')).toBeTruthy();
        expect(screen.queryByText('feature/policy-etl')).toBeNull();
        expect(screen.queryByRole('button', { name: /切换分支，当前/ })).toBeNull();
    });

    it('shows operations center entry when offline read permission is available', async () => {
        renderOfflineLayout();

        expect(await screen.findByText('policy')).toBeTruthy();
        expect(screen.getByRole('link', { name: /运维中心/ }).getAttribute('href')).toBe('/operations');
    });

    it('shows parameter group entry when parameter read permission is available', async () => {
        useAuthStore.setState({ permissions: ['offline.read', 'parameter.read'] });
        renderOfflineLayout();

        expect(await screen.findByText('policy')).toBeTruthy();
        expect(screen.getByRole('link', { name: /参数组/ }).getAttribute('href')).toBe('/parameters');
    });

    it('leaves branch lookup and switching to the offline workbench', async () => {
        renderOfflineLayout();

        expect(await screen.findByText('policy')).toBeTruthy();
        expect(getOfflineRepoStatus).not.toHaveBeenCalled();
        expect(screen.queryByRole('combobox', { name: /切换工作分支/ })).toBeNull();
        expect(listBranches).not.toHaveBeenCalled();
        expect(switchBranch).not.toHaveBeenCalled();
    });

    it('does not react to workbench branch change events in the navbar', async () => {
        renderOfflineLayout();
        expect(await screen.findByText('policy')).toBeTruthy();

        window.dispatchEvent(new CustomEvent('wbdata:offline-branch-changed', {
            detail: { groupId: 4, branch: 'main' },
        }));

        expect(screen.queryByText('main')).toBeNull();
        expect(getOfflineRepoStatus).not.toHaveBeenCalled();
    });

    describe('logout', () => {
        function openAccountMenu() {
            fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
            return screen.getByRole<HTMLButtonElement>('menuitem', { name: '退出登录' });
        }

        it('preserves auth while pending and prevents duplicate requests even after reopening the menu', async () => {
            let resolveLogout!: () => void;
            const pending = new Promise<void>((resolve) => { resolveLogout = resolve; });
            vi.mocked(logout).mockReturnValueOnce(pending);
            const authBeforeLogout = useAuthStore.getState();
            renderOfflineLayout();
            const logoutButton = openAccountMenu();

            act(() => {
                logoutButton.click();
                logoutButton.click();
            });

            expect(logout).toHaveBeenCalledTimes(1);
            expect(useAuthStore.getState()).toEqual(authBeforeLogout);
            expect(localStorage.getItem('wb_access_token')).toBe('token');
            expect(showFeedbackSpy).not.toHaveBeenCalled();

            const pendingButton = openAccountMenu();
            expect(pendingButton.disabled).toBe(true);
            fireEvent.click(pendingButton);
            expect(logout).toHaveBeenCalledTimes(1);

            await act(async () => { resolveLogout(); await pending; });
            expect(useAuthStore.getState().token).toBeNull();
        });

        it('clears the token, persisted login and auth context only after a successful logout', async () => {
            vi.mocked(logout).mockImplementationOnce(async () => {
                expect(useAuthStore.getState().token).toBe('token');
                expect(localStorage.getItem('wb_access_token')).toBe('token');
            });
            renderOfflineLayout();
            fireEvent.click(openAccountMenu());

            await waitFor(() => expect(useAuthStore.getState().token).toBeNull());
            expect(logout).toHaveBeenCalledTimes(1);
            expect(localStorage.getItem('wb_access_token')).toBeNull();
            expect(useAuthStore.getState()).toMatchObject({
                userInfo: null,
                systemAdmin: false,
                currentGroup: null,
                accessibleGroups: [],
                permissions: [],
                contextLoaded: false,
            });
            expect(showFeedbackSpy).not.toHaveBeenCalled();
        });

        it.each([
            ['network failure', new AxiosError('Network Error', 'ERR_NETWORK')],
            ['HTTP server failure', httpError(500)],
            ['application failure', new Error('注销失败')],
        ])('preserves login and offers a retry after %s', async (_label, error) => {
            vi.mocked(logout).mockRejectedValueOnce(error);
            const authBeforeLogout = useAuthStore.getState();
            renderOfflineLayout();
            fireEvent.click(openAccountMenu());

            await waitFor(() => expect(showFeedbackSpy).toHaveBeenCalledWith({
                tone: 'error',
                title: '退出失败',
                detail: '未能确认服务端注销，请重试。',
            }));
            expect(showFeedbackSpy).toHaveBeenCalledTimes(1);
            expect(logout).toHaveBeenCalledTimes(1);
            expect(useAuthStore.getState()).toEqual(authBeforeLogout);
            expect(localStorage.getItem('wb_access_token')).toBe('token');
            expect(openAccountMenu().disabled).toBe(false);
        });

        it('allows reopening the menu and successfully retrying a failed logout', async () => {
            vi.mocked(logout)
                .mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
                .mockResolvedValueOnce(undefined);
            renderOfflineLayout();
            fireEvent.click(openAccountMenu());
            await waitFor(() => expect(showFeedbackSpy).toHaveBeenCalledTimes(1));

            const retryButton = openAccountMenu();
            expect(retryButton.disabled).toBe(false);
            fireEvent.click(retryButton);

            await waitFor(() => expect(useAuthStore.getState().token).toBeNull());
            expect(logout).toHaveBeenCalledTimes(2);
            expect(localStorage.getItem('wb_access_token')).toBeNull();
            expect(showFeedbackSpy).toHaveBeenCalledTimes(1);
        });

        it('leaves 401 handling to the shared interceptor without misleading failure feedback', async () => {
            vi.mocked(logout).mockImplementationOnce(async () => {
                // Simulate the interceptor clearing auth before rejecting the request.
                useAuthStore.getState().clearAuth();
                throw httpError(401);
            });
            renderOfflineLayout();

            await act(async () => { fireEvent.click(openAccountMenu()); });

            expect(logout).toHaveBeenCalledTimes(1);
            expect(useAuthStore.getState().token).toBeNull();
            expect(localStorage.getItem('wb_access_token')).toBeNull();
            expect(showFeedbackSpy).not.toHaveBeenCalled();
        });
    });
});
