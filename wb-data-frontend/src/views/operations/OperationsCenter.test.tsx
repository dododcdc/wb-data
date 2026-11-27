import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { getOfflineRepoStatus } from '../../api/offline';
import {
    getOperationsExecution,
    getOperationsExecutionRerunContext,
    listOperationsExecutions,
    markOperationsExecutionSuccess,
    rerunOperationsExecution,
    stopOperationsExecution,
} from '../../api/operations';
import { formatLocalDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import { TooltipProvider } from '../../components/ui/tooltip';
import OperationsCenter from './OperationsCenter';
import * as SimpleSelectModule from '../../components/SimpleSelect';

const { showSuccess, showError } = vi.hoisted(() => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('../../api/offline', () => ({
    getOfflineRepoStatus: vi.fn(),
}));

vi.mock('../../api/operations', () => ({
    getOperationsExecution: vi.fn(),
    getOperationsExecutionRerunContext: vi.fn(),
    listOperationsExecutions: vi.fn(),
    markOperationsExecutionSuccess: vi.fn(),
    rerunOperationsExecution: vi.fn(),
    stopOperationsExecution: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ReactFlow: ({
        nodes,
        nodeTypes,
    }: {
        nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
        nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
    }) => (
        <div>
            {nodes.map((node) => {
                const Renderer = node.type ? nodeTypes?.[node.type] : undefined;
                return <div key={node.id}>{Renderer ? <Renderer data={node.data} /> : node.id}</div>;
            })}
        </div>
    ),
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    BackgroundVariant: { Dots: 'dots' },
    Background: () => null,
    Controls: () => null,
    useNodesInitialized: () => true,
    useReactFlow: () => ({ fitView: vi.fn(() => Promise.resolve(true)) }),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({ showSuccess, showError }),
}));

vi.mock('./OperationsTimeFilter', () => ({
    OperationsTimeFilter: ({
        from,
        to,
        onChange,
        onRollingWindowChange,
    }: {
        from: string;
        to: string;
        onChange: (from: string, to: string) => void;
        onRollingWindowChange?: (windowMs: number | null) => void;
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
            <button
                type="button"
                onClick={() => {
                    onChange('2026-06-13 12:00:00', '2026-06-20 12:00:00');
                    onRollingWindowChange?.(7 * 24 * 60 * 60 * 1000);
                }}
            >
                应用最近 7 天
            </button>
        </div>
    ),
}));


const listOperationsExecutionsMock = vi.mocked(listOperationsExecutions);
const getOperationsExecutionMock = vi.mocked(getOperationsExecution);
const getOperationsExecutionRerunContextMock = vi.mocked(getOperationsExecutionRerunContext);
const markOperationsExecutionSuccessMock = vi.mocked(markOperationsExecutionSuccess);
const rerunOperationsExecutionMock = vi.mocked(rerunOperationsExecution);
const stopOperationsExecutionMock = vi.mocked(stopOperationsExecution);
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
                    rerun: false,
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
                    rerun: true,
                    rerunType: 'MANUAL',
                },
                {
                    id: 'exec-3',
                    namespace: 'g4-feature-policy-review',
                    flowId: 'auto_retry_job',
                    branch: 'feature/policy-review',
                    status: 'RETRIED',
                    plannedAt: '2026-06-06T22:00:00Z',
                    createdAt: '2026-06-06T23:00:00Z',
                    startDate: '2026-06-06T23:00:01Z',
                    endDate: '2026-06-06T23:00:10Z',
                    durationMs: 9000,
                    rerunnable: false,
                    rerun: true,
                    rerunType: 'AUTO',
                    retryAttempt: 1,
                },
            ],
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
            taskRuns: [],
            inputs: { bizDate: '2026-06-07' },
            labels: { wbdataParameterOverrideKeys: 'bizDate' },
            parameterResolutionStatus: 'AVAILABLE',
            parameters: [{
                key: 'bizDate',
                dataType: 'DATE',
                value: '2026-06-07',
                source: 'MANUAL_OVERRIDE',
            }],
        });
        getOperationsExecutionRerunContextMock.mockResolvedValue({
            executionId: 'exec-1',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            partialRerunSupported: false,
            graphChanged: false,
            fallbackReason: null,
            nodes: [],
            edges: [],
            defaultSelectedTaskIds: [],
            requiredTaskIds: [],
        });
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    function renderPage(initialEntry = '/') {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <TooltipProvider><QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[initialEntry]}>
                    <Routes>
                        <Route path="/" element={<OperationsCenter />} />
                        <Route path="/operations" element={<OperationsCenter />} />
                        <Route path="/operations/instances" element={<div>execution detail route</div>} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider></TooltipProvider>
        );
    }

    it('loads current branch and renders formal executions', async () => {
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        expect(screen.getByText('手动重跑')).toBeTruthy();
        expect(screen.getByText('自动重试 #1')).toBeTruthy();
        expect(screen.getAllByText('已重试').length).toBeGreaterThan(0);
        expect(screen.queryByText('运维中心')).toBeNull();
        expect(screen.getAllByText('feature/policy-review').length).toBeGreaterThan(0);
        expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
        expect(within(screen.getByLabelText('运行记录筛选')).getByRole('button', { name: '刷新运行记录' })).toBeTruthy();
        expect(screen.getAllByRole('columnheader')).toHaveLength(9);
        expect(screen.getByRole('columnheader', { name: '负责人' })).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: '结束时间' })).toBeTruthy();
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
        const detailButton = within(row).getByRole('button', { name: '查看 daily_policy 详情' });

        expect(detailButton).toBeTruthy();
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
                    rerun: false,
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

    it('confirms rerun without silently reusing manual overrides', async () => {
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

        expect(await screen.findByRole('heading', { name: '确认重跑任务' })).toBeTruthy();
        expect(await screen.findByText('新执行启动时重新取得')).toBeTruthy();
        expect((await screen.findByRole('checkbox', { name: '沿用原执行的手动覆盖值' }) as HTMLInputElement).checked).toBe(false);
        expect(rerunOperationsExecutionMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认重跑' }));

        await waitFor(() => expect(rerunOperationsExecutionMock).toHaveBeenCalledWith(
            4,
            'exec-1',
            { reuseManualOverrides: false },
        ));
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

    it('renders clickable status summary bar and filters by status pill', async () => {
        listOperationsExecutionsMock.mockResolvedValue({
            branches: ['feature/policy-review', 'main'],
            selectedBranch: 'feature/policy-review',
            from: '2026-06-06T02:00:00Z',
            to: '2026-06-07T02:00:00Z',
            page: 1,
            pageSize: 50,
            total: 2,
            totalPages: 1,
            statusCounts: { total: 12, success: 7, failed: 3, active: 2, stopped: 0 },
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
                    stoppable: false,
                    rerun: false,
                },
            ],
        });
        renderPage();

        const summaryGroup = await screen.findByRole('group', { name: '状态速览' });
        expect(await within(summaryGroup).findByText('12')).toBeTruthy();
        expect(within(summaryGroup).getByText('3')).toBeTruthy();
        expect(within(summaryGroup).getByText('2')).toBeTruthy();
        expect(within(summaryGroup).getByText('7')).toBeTruthy();

        const failedPill = within(summaryGroup).getByRole('button', { name: /失败/ });
        fireEvent.click(failedPill);

        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'FAILED', page: 1 })
        ));
        expect(failedPill.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(failedPill);

        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: null, page: 1 })
        ));

        fireEvent.click(within(summaryGroup).getByRole('button', { name: /进行中/ }));

        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'ACTIVE', page: 1 })
        ));
    });

    it('confirms stop for active execution and refreshes list', async () => {
        stopOperationsExecutionMock.mockResolvedValue(undefined);
        listOperationsExecutionsMock.mockResolvedValue({
            branches: ['feature/policy-review', 'main'],
            selectedBranch: 'feature/policy-review',
            from: '2026-06-06T02:00:00Z',
            to: '2026-06-07T02:00:00Z',
            page: 1,
            pageSize: 50,
            total: 1,
            totalPages: 1,
            statusCounts: { total: 1, success: 0, failed: 0, active: 1, stopped: 0 },
            executions: [
                {
                    id: 'exec-run',
                    namespace: 'g4-feature-policy-review',
                    flowId: 'streaming_job',
                    branch: 'feature/policy-review',
                    status: 'RUNNING',
                    plannedAt: '2026-06-07T00:00:00Z',
                    createdAt: '2026-06-07T01:00:00Z',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: null,
                    durationMs: null,
                    rerunnable: false,
                    stoppable: true,
                    rerun: false,
                },
            ],
        });
        renderPage();

        const stopButton = await screen.findByRole('button', { name: '停止 streaming_job' });
        fireEvent.click(stopButton);

        expect(await screen.findByRole('heading', { name: '确认停止任务' })).toBeTruthy();
        expect(stopOperationsExecutionMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认停止' }));

        await waitFor(() => expect(stopOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-run'));
        expect(showSuccess).toHaveBeenCalledWith('已发送停止请求');
        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenCalledTimes(2));
    });

    it('toggles auto refresh preference in operations list', async () => {
        renderPage();

        const toggle = await screen.findByRole('button', { name: /自动刷新/ });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.textContent).toContain('自动刷新已关闭');
    });

    it('advances the rolling time window on manual refresh and preserves fixed custom ranges', async () => {
        const initialNow = new Date(2026, 5, 20, 12, 0, 0).getTime();
        const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(initialNow);

        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        const refreshButton = within(screen.getByLabelText('运行记录筛选'))
            .getByRole('button', { name: '刷新运行记录' }) as HTMLButtonElement;
        await waitFor(() => expect(refreshButton.disabled).toBe(false));

        const plusFiveMin = new Date(2026, 5, 20, 12, 5, 0).getTime();
        dateNowSpy.mockReturnValue(plusFiveMin);
        fireEvent.click(refreshButton);

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date(plusFiveMin - 24 * 60 * 60 * 1000).toISOString(),
                    to: new Date(plusFiveMin).toISOString(),
                })
            );
        });
        expect(screen.getByTestId('range-to').textContent).toBe(formatLocalDateTime(new Date(plusFiveMin)));

        fireEvent.click(screen.getByRole('button', { name: '应用测试时间范围' }));
        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date('2026-06-07T01:00:15').toISOString(),
                    to: new Date('2026-06-07T02:00:45').toISOString(),
                })
            );
        });

        await waitFor(() => expect(refreshButton.disabled).toBe(false));
        const plusTenMin = new Date(2026, 5, 20, 12, 10, 0).getTime();
        dateNowSpy.mockReturnValue(plusTenMin);
        fireEvent.click(refreshButton);

        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                from: new Date('2026-06-07T01:00:15').toISOString(),
                to: new Date('2026-06-07T02:00:45').toISOString(),
            })
        ));
        expect(screen.getByTestId('range-to').textContent).toBe('2026-06-07 02:00:45');

        fireEvent.click(screen.getByRole('button', { name: '应用最近 7 天' }));
        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date('2026-06-13T12:00:00').toISOString(),
                    to: new Date('2026-06-20T12:00:00').toISOString(),
                })
            );
        });

        await waitFor(() => expect(refreshButton.disabled).toBe(false));
        const plusFifteenMin = new Date(2026, 5, 20, 12, 15, 0).getTime();
        dateNowSpy.mockReturnValue(plusFifteenMin);
        fireEvent.click(refreshButton);

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date(plusFifteenMin - 7 * 24 * 60 * 60 * 1000).toISOString(),
                    to: new Date(plusFifteenMin).toISOString(),
                })
            );
        });
    });

    it('advances the rolling time window after triggering rerun', async () => {
        const initialNow = new Date(2026, 5, 20, 12, 0, 0).getTime();
        const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(initialNow);
        rerunOperationsExecutionMock.mockResolvedValue({
            originalExecutionId: 'exec-1',
            newExecutionId: 'exec-3',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            status: 'CREATED',
            createdAt: '2026-06-20T04:03:00Z',
        });

        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '重跑 daily_policy' }));
        expect(await screen.findByRole('heading', { name: '确认重跑任务' })).toBeTruthy();
        expect(await screen.findByText('新执行启动时重新取得')).toBeTruthy();

        const rerunNow = new Date(2026, 5, 20, 12, 3, 0).getTime();
        dateNowSpy.mockReturnValue(rerunNow);
        fireEvent.click(screen.getByRole('button', { name: '确认重跑' }));

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date(rerunNow - 24 * 60 * 60 * 1000).toISOString(),
                    to: new Date(rerunNow).toISOString(),
                })
            );
        });
    });

    it('includes FORCE_SUCCESS status filter and confirms mark-success action', async () => {
        markOperationsExecutionSuccessMock.mockResolvedValue(undefined);
        renderPage();

        const statusSelect = await screen.findByTestId('status-select') as HTMLSelectElement;
        expect(Array.from(statusSelect.options).some((opt) => opt.value === 'FORCE_SUCCESS' && opt.text === '人工置成功'))
            .toBe(true);

        const markBtn = await screen.findByRole('button', { name: '置成功 daily_policy' });
        fireEvent.click(markBtn);

        expect(await screen.findByRole('heading', { name: '确认置成功' })).toBeTruthy();
        expect(markOperationsExecutionSuccessMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认置成功' }));

        await waitFor(() => expect(markOperationsExecutionSuccessMock).toHaveBeenCalledWith(4, 'exec-1'));
        expect(showSuccess).toHaveBeenCalledWith('已置为成功');
        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenCalledTimes(2));
    });

    it('initializes status filter from ?status= URL query parameter', async () => {
        renderPage('/operations?status=FAILED');

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    groupId: 4,
                    status: 'FAILED',
                }),
            );
        });
        const statusSelect = await screen.findByTestId('status-select') as HTMLSelectElement;
        expect(statusSelect.value).toBe('FAILED');
    });

    it('initializes branch filter from ?branch= URL query parameter instead of current repo branch', async () => {
        renderPage('/operations?status=FAILED&branch=main');

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    groupId: 4,
                    branch: 'main',
                    status: 'FAILED',
                }),
            );
        });
        const branchSelect = await screen.findByTestId('branch-select') as HTMLSelectElement;
        expect(branchSelect.value).toBe('main');
    });

    it('supports ?branch=__all__ URL query parameter to show all synced branches', async () => {
        renderPage('/operations?branch=__all__');

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    groupId: 4,
                    branch: null,
                }),
            );
        });
        const branchSelect = await screen.findByTestId('branch-select') as HTMLSelectElement;
        expect(branchSelect.value).toBe('__all_branches__');
    });
});
