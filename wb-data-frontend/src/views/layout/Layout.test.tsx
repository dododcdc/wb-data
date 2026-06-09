import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Layout from './Layout';
import { useAuthStore } from '../../utils/auth';
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

describe('Layout workspace context', () => {
    beforeEach(() => {
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
});
