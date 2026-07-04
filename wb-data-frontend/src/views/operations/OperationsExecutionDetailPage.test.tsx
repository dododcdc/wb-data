import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    rerunOperationsExecution,
} from '../../api/operations';
import { formatLocalDateTime } from '../../lib/dateTime';
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
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:00:00Z',
            startDate: '2026-06-07T01:00:02Z',
            endDate: '2026-06-07T01:03:12Z',
            durationMs: 190000,
            rerunnable: true,
            taskRuns: [
                {
                    taskId: 'flow_dag',
                    status: 'SUCCESS',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: '2026-06-07T01:00:03Z',
                    durationMs: 1000,
                },
                {
                    taskId: 'parallel_root',
                    status: 'SUCCESS',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: '2026-06-07T01:00:03Z',
                    durationMs: 1000,
                },
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
        expect(screen.queryByRole('button', { name: '刷新执行详情' })).toBeNull();
        expect(screen.getAllByRole('button', { name: '刷新当前执行' })).toHaveLength(1);
        expect(screen.queryByText('exec-1')).toBeNull();
        expect(screen.getByText('feature/policy-review')).toBeTruthy();
        expect(screen.getByText('计划执行时间')).toBeTruthy();
        expect(screen.queryByText('触发时间')).toBeNull();
        expect(screen.queryByRole('button', { name: '全部日志' })).toBeNull();
        expect(screen.queryByText('节点')).toBeNull();
        expect(screen.queryByText('日志')).toBeNull();
        expect(document.querySelector('.operations-execution-log-header')).toBeNull();
        expect(screen.getByRole('button', { name: '刷新当前执行' }).closest('.operations-execution-log-tools')).not.toBeNull();
        expect(screen.getByText(formatLocalDateTime(new Date('2026-06-07T00:00:00Z')))).toBeTruthy();
        expect(screen.getByText(formatLocalDateTime(new Date('2026-06-07T01:00:02Z')))).toBeTruthy();
        expect(screen.queryByRole('button', { name: '查看 flow_dag 日志' })).toBeNull();
        expect(screen.queryByRole('button', { name: '查看 parallel_root 日志' })).toBeNull();
        const summary = screen.getByLabelText('执行摘要');
        expect(within(summary).getByText('节点数').nextElementSibling?.textContent).toBe('2');
        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'load_policy'));
        expect(await screen.findByText('load failed on row 42')).toBeTruthy();
        expect(getOperationsExecutionLogsMock).not.toHaveBeenCalledWith(4, 'exec-1', null);

        fireEvent.click(screen.getByRole('button', { name: '查看 extract_policy 日志' }));

        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'extract_policy'));
        expect(await screen.findByText('extract finished')).toBeTruthy();
    });

    it('refreshes the current execution and logs from one action', async () => {
        renderPage();

        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'load_policy'));
        const detailCalls = getOperationsExecutionMock.mock.calls.length;
        const logCalls = getOperationsExecutionLogsMock.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: '刷新当前执行' }));

        await waitFor(() => expect(getOperationsExecutionMock.mock.calls.length).toBeGreaterThan(detailCalls));
        await waitFor(() => expect(getOperationsExecutionLogsMock.mock.calls.length).toBeGreaterThan(logCalls));
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
