import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    rerunOperationsExecution,
} from '../../api/operations';
import { useAuthStore } from '../../utils/auth';
import OperationsExecutionDetailPage from './OperationsExecutionDetailPage';

const { showFeedback } = vi.hoisted(() => ({
    showFeedback: vi.fn(),
}));

vi.mock('../../api/operations', () => ({
    getOperationsExecution: vi.fn(),
    getOperationsExecutionLogs: vi.fn(),
    rerunOperationsExecution: vi.fn(),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({ showFeedback }),
}));

const getOperationsExecutionMock = vi.mocked(getOperationsExecution);
const getOperationsExecutionLogsMock = vi.mocked(getOperationsExecutionLogs);
const rerunOperationsExecutionMock = vi.mocked(rerunOperationsExecution);

describe('OperationsExecutionDetailPage', () => {
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

        getOperationsExecutionMock.mockResolvedValue({
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
            taskRuns: [
                {
                    taskId: 'extract_policy',
                    status: 'SUCCESS',
                    startDate: '2026-06-07T01:00:03Z',
                    endDate: '2026-06-07T01:01:00Z',
                    durationMs: 57000,
                },
                {
                    taskId: 'load_policy',
                    status: 'FAILED',
                    startDate: '2026-06-07T01:01:02Z',
                    endDate: '2026-06-07T01:03:10Z',
                    durationMs: 128000,
                },
            ],
            inputs: { bizDate: '2026-06-07' },
            labels: { owner: 'policy' },
        });

        getOperationsExecutionLogsMock.mockImplementation((_groupId, _executionId, taskId) => {
            if (taskId === 'extract_policy') {
                return Promise.resolve([
                    {
                        timestamp: '2026-06-07T01:00:40Z',
                        taskId: 'extract_policy',
                        level: 'INFO',
                        message: 'extract finished',
                    },
                ]);
            }

            return Promise.resolve([
                {
                    timestamp: '2026-06-07T01:02:40Z',
                    taskId: 'load_policy',
                    level: 'ERROR',
                    message: 'load failed on row 42',
                },
            ]);
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
                <MemoryRouter initialEntries={['/operations/executions/exec-1']}>
                    <Routes>
                        <Route path="/operations/executions/:executionId" element={<OperationsExecutionDetailPage />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
    }

    it('loads detail and focuses failed task logs', async () => {
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        expect(screen.getByText('feature/policy-review')).toBeTruthy();
        expect(screen.getByText('load_policy failed')).toBeTruthy();
        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'load_policy'));
        expect(await screen.findByText('load failed on row 42')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '查看 extract_policy 日志' }));

        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'extract_policy'));
        expect(await screen.findByText('extract finished')).toBeTruthy();
    });

    it('reruns the whole execution when permitted', async () => {
        rerunOperationsExecutionMock.mockResolvedValue({
            originalExecutionId: 'exec-1',
            newExecutionId: 'exec-2',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            status: 'CREATED',
            createdAt: '2026-06-07T02:00:00Z',
        });
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '重跑任务' }));

        await waitFor(() => expect(rerunOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-1'));
        expect(showFeedback).toHaveBeenCalledWith({
            tone: 'success',
            title: '已触发重跑',
            detail: '',
        });
    });
});
