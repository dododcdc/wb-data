import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOfflineRepoStatus } from '../../api/offline';
import { listOperationsExecutions, rerunOperationsExecution } from '../../api/operations';
import { useAuthStore } from '../../utils/auth';
import OperationsCenter from './OperationsCenter';

const { showFeedback } = vi.hoisted(() => ({
    showFeedback: vi.fn(),
}));

vi.mock('../../api/offline', () => ({
    getOfflineRepoStatus: vi.fn(),
}));

vi.mock('../../api/operations', () => ({
    listOperationsExecutions: vi.fn(),
    rerunOperationsExecution: vi.fn(),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({ showFeedback }),
}));

const listOperationsExecutionsMock = vi.mocked(listOperationsExecutions);
const rerunOperationsExecutionMock = vi.mocked(rerunOperationsExecution);
const getOfflineRepoStatusMock = vi.mocked(getOfflineRepoStatus);

describe('OperationsCenter', () => {
    beforeEach(() => {
        useAuthStore.setState({
            token: 'token',
            userInfo: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
            systemAdmin: false,
            currentGroup: { id: 4, name: 'policy', description: '', role: 'DEVELOPER' },
            accessibleGroups: [{ id: 4, name: 'policy', description: '', role: 'DEVELOPER' }],
            permissions: ['offline.read', 'offline.write'],
            contextLoaded: true,
        });
        getOfflineRepoStatusMock.mockResolvedValue({
            groupId: 4,
            repoPath: '/tmp/wb-data-4',
            exists: true,
            gitInitialized: true,
            dirty: false,
            ahead: false,
            hasRemote: true,
            hasUpstream: true,
            branch: 'feature/policy-review',
            headCommitId: 'abc',
            headCommitMessage: 'init',
            headCommitAt: null,
        });
        listOperationsExecutionsMock.mockResolvedValue({
            branches: ['feature/policy-review', 'main'],
            selectedBranch: 'feature/policy-review',
            from: '2026-06-06T02:00:00Z',
            to: '2026-06-07T02:00:00Z',
            executions: [
                {
                    id: 'exec-1',
                    namespace: 'g4-feature-policy-review',
                    flowId: 'daily_policy',
                    branch: 'feature/policy-review',
                    status: 'FAILED',
                    createdAt: '2026-06-07T01:00:00Z',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: '2026-06-07T01:03:12Z',
                    durationMs: 190000,
                    failureSummary: 'load_policy failed',
                    rerunnable: true,
                },
                {
                    id: 'exec-2',
                    namespace: 'g4-feature-policy-review',
                    flowId: 'hourly_policy',
                    branch: 'feature/policy-review',
                    status: 'SUCCESS',
                    createdAt: '2026-06-07T00:00:00Z',
                    startDate: '2026-06-07T00:00:01Z',
                    endDate: '2026-06-07T00:01:01Z',
                    durationMs: 60000,
                    failureSummary: null,
                    rerunnable: false,
                },
            ],
        });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    function renderPage() {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <OperationsCenter />
                </MemoryRouter>
            </QueryClientProvider>
        );
    }

    it('loads current branch and renders formal executions', async () => {
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        expect(screen.getAllByText('feature/policy-review').length).toBeGreaterThan(0);
        expect(screen.getByText('失败')).toBeTruthy();
        expect(screen.getByText('load_policy failed')).toBeTruthy();
        expect(screen.getByRole('button', { name: '重跑 daily_policy' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '重跑 hourly_policy' })).toBeNull();
        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenCalledWith(
            expect.objectContaining({ groupId: 4, branch: 'feature/policy-review' })
        ));
    });

    it('reruns failed execution and refreshes list', async () => {
        rerunOperationsExecutionMock.mockResolvedValue({
            originalExecutionId: 'exec-1',
            newExecutionId: 'exec-3',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            status: 'CREATED',
            createdAt: '2026-06-07T02:00:00Z',
        });
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '重跑 daily_policy' }));

        await waitFor(() => expect(rerunOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-1'));
        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenCalledTimes(2));
    });
});
