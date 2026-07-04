import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOfflineRepoStatus } from '../../api/offline';
import { listOperationsExecutions, rerunOperationsExecution } from '../../api/operations';
import { formatLocalDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import OperationsCenter from './OperationsCenter';
import * as SimpleSelectModule from '../../components/SimpleSelect';

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

vi.mock('./OperationsTimeFilter', () => ({
    OperationsTimeFilter: ({
        from,
        to,
        onChange,
    }: {
        from: string;
        to: string;
        onChange: (from: string, to: string) => void;
    }) => (
        <div data-testid="mock-time-range-picker">
            <span data-testid="range-from">{from}</span>
            <span data-testid="range-to">{to}</span>
            <button
                type="button"
                onClick={() => onChange('2026-06-07 01:00:15', '2026-06-07 02:00:45')}
            >
                应用测试时间范围
            </button>
        </div>
    ),
}));


const listOperationsExecutionsMock = vi.mocked(listOperationsExecutions);
const rerunOperationsExecutionMock = vi.mocked(rerunOperationsExecution);
const getOfflineRepoStatusMock = vi.mocked(getOfflineRepoStatus);

describe('OperationsCenter', () => {
    beforeEach(() => {
        vi.spyOn(SimpleSelectModule, 'SimpleSelect').mockImplementation(
            ({ value, options, onChange, id, className, disabled }: { value?: string; options: { label: string; value: string }[]; onChange: (val: string) => void; id?: string; className?: string; disabled?: boolean }) => (
                <select
                    data-testid={id || 'simple-select'}
                    className={className}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            )
        );
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
            page: 1,
            pageSize: 50,
            total: 2,
            totalPages: 1,
            executions: [
                {
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
                },
                {
                    id: 'exec-2',
                    namespace: 'g4-feature-policy-review',
                    flowId: 'hourly_policy',
                    branch: 'feature/policy-review',
                    status: 'SUCCESS',
                    plannedAt: '2026-06-06T23:00:00Z',
                    createdAt: '2026-06-07T00:00:00Z',
                    startDate: '2026-06-07T00:00:01Z',
                    endDate: '2026-06-07T00:01:01Z',
                    durationMs: 60000,
                    rerunnable: false,
                },
            ],
        });
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    function renderPage() {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <Routes>
                        <Route path="/" element={<OperationsCenter />} />
                        <Route path="/operations/executions/:executionId" element={<div>execution detail route</div>} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
    }

    it('loads current branch and renders formal executions', async () => {
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        expect(screen.queryByText('运维中心')).toBeNull();
        expect(screen.getAllByText('feature/policy-review').length).toBeGreaterThan(0);
        expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
        expect(within(screen.getByLabelText('运行记录筛选')).getByRole('button', { name: '刷新运行记录' })).toBeTruthy();
        expect(screen.getAllByRole('columnheader')).toHaveLength(8);
        expect(screen.getByRole('columnheader', { name: '计划执行时间' })).toBeTruthy();
        expect(screen.queryByRole('columnheader', { name: '触发时间' })).toBeNull();
        expect(screen.getByRole('button', { name: '重跑 daily_policy' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '重跑 hourly_policy' })).toBeNull();
        expect(screen.getByText(formatLocalDateTime(new Date('2026-06-07T00:00:00Z')))).toBeTruthy();
        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenCalledWith(
            expect.objectContaining({ groupId: 4, branch: 'feature/policy-review', pageSize: 50 })
        ));
    });

    it('opens detail from the row and keeps detail action compact', async () => {
        renderPage();

        const row = await screen.findByRole('row', { name: '查看 daily_policy 执行详情' });
        const detailLink = within(row).getByRole('link', { name: '查看 daily_policy 详情' });

        expect(detailLink.getAttribute('title')).toBe('查看详情');
        expect(within(row).queryByText('查看详情')).toBeNull();

        fireEvent.click(row);

        expect(await screen.findByText('execution detail route')).toBeTruthy();
    });

    it('changes operations pages and page size', async () => {
        listOperationsExecutionsMock.mockResolvedValue({
            branches: ['feature/policy-review', 'main'],
            selectedBranch: 'feature/policy-review',
            from: '2026-06-06T02:00:00Z',
            to: '2026-06-07T02:00:00Z',
            page: 1,
            pageSize: 50,
            total: 75,
            totalPages: 2,
            executions: [
                {
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
                },
            ],
        });
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '下一页' }));

        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ page: 2, pageSize: 50 })
        ));

        const pageSizeSelect = await screen.findByTestId('operations-page-size') as HTMLSelectElement;
        expect(Array.from(pageSizeSelect.options).map(option => option.value)).toEqual(['50', '100', '200']);
        await waitFor(() => expect(pageSizeSelect.disabled).toBe(false));
        fireEvent.change(pageSizeSelect, { target: { value: '100' } });

        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ page: 1, pageSize: 100 })
        ));
        expect(window.localStorage.getItem('wb-data.operations.pageSize')).toBe('100');
    });

    it('uses the remembered operations page size', async () => {
        window.localStorage.setItem('wb-data.operations.pageSize', '100');

        renderPage();

        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ page: 1, pageSize: 100 })
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

    it('renders distinct status option labels to avoid duplicates', async () => {
        renderPage();
        const statusSelect = await screen.findByTestId('status-select') as HTMLSelectElement;
        const options = Array.from(statusSelect.options).map(opt => opt.text);
        expect(options).toContain('已创建');
        expect(options).toContain('排队中');
        expect(options.filter(o => o === '就绪').length).toBe(0);
    });

    it('queries only with the applied second-precision range', async () => {
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '应用测试时间范围' }));

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date('2026-06-07T01:00:15').toISOString(),
                    to: new Date('2026-06-07T02:00:45').toISOString(),
                })
            );
        });
    });

    it('initializes an explicit browser-local last-24-hours range', async () => {
        const now = new Date(2026, 5, 20, 12, 0, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now.getTime());

        renderPage();

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
                    to: now.toISOString(),
                })
            );
        });
    });

    it('resets an applied custom range to the browser-local last 24 hours', async () => {
        const now = new Date(2026, 5, 20, 12, 0, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '应用测试时间范围' }));
        await waitFor(() => expect(screen.getByTestId('range-from').textContent).toBe('2026-06-07 01:00:15'));

        fireEvent.click(screen.getByRole('button', { name: '重置' }));

        expect(screen.getByTestId('range-from').textContent)
            .toBe(formatLocalDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
        expect(screen.getByTestId('range-to').textContent).toBe(formatLocalDateTime(now));
    });
});
