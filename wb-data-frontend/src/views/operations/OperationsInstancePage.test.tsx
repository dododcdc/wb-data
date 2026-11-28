import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    getOperationsExecutionNodeSnapshot,
    getOperationsExecutionRerunContext,
    getOperationsInstanceDiagnosis,
    markOperationsExecutionSuccess,
    rerunOperationsExecution,
    stopOperationsExecution,
    type OperationsInstanceDiagnosis,
} from '../../api/operations';
import { formatBrowserDateTime, formatLocalDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import OperationsInstancePage from './OperationsInstancePage';
import {
    getInstanceStateLabel,
    getInstanceStateTone,
    isActiveInstanceState,
} from './instancePresentation';

const { showSuccess, showError } = vi.hoisted(() => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('../../api/operations', () => ({
    getOperationsExecution: vi.fn(),
    getOperationsExecutionLogs: vi.fn(),
    getOperationsExecutionNodeSnapshot: vi.fn(),
    getOperationsExecutionRerunContext: vi.fn(),
    getOperationsInstanceDiagnosis: vi.fn(),
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

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: {
        data: unknown[];
        itemContent: (index: number, item: unknown) => React.ReactNode;
    }) => (
        <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>
    ),
}));

const getOperationsExecutionMock = vi.mocked(getOperationsExecution);
const getOperationsExecutionLogsMock = vi.mocked(getOperationsExecutionLogs);
const getOperationsExecutionNodeSnapshotMock = vi.mocked(getOperationsExecutionNodeSnapshot);
const getOperationsExecutionRerunContextMock = vi.mocked(getOperationsExecutionRerunContext);
const getOperationsInstanceDiagnosisMock = vi.mocked(getOperationsInstanceDiagnosis);
const markOperationsExecutionSuccessMock = vi.mocked(markOperationsExecutionSuccess);
const rerunOperationsExecutionMock = vi.mocked(rerunOperationsExecution);
const stopOperationsExecutionMock = vi.mocked(stopOperationsExecution);

function buildDiagnosis(overrides: Partial<OperationsInstanceDiagnosis> = {}): OperationsInstanceDiagnosis {
    return {
        flowId: 'daily_policy',
        branch: 'feature/policy-review',
        namespace: 'g4-feature-policy-review',
        scheduleKey: '2026-06-07',
        period: 'DAILY',
        cron: '0 2 * * *',
        timezone: 'Asia/Shanghai',
        scheduleEnabled: true,
        plannedFireAt: '2026-06-07T00:00:00Z',
        state: 'FAILED',
        reason: null,
        executions: [
            {
                id: 'exec-1',
                status: 'FAILED',
                plannedAt: '2026-06-07T00:00:00Z',
                createdAt: '2026-06-07T01:00:00Z',
                startDate: '2026-06-07T01:00:02Z',
                endDate: '2026-06-07T01:03:12Z',
                durationMs: 190000,
                rerun: false,
            },
        ],
        upstreams: [],
        prevScheduleKey: '2026-06-06',
        nextScheduleKey: '2026-06-08',
        ...overrides,
    };
}

function LocationEcho() {
    const location = useLocation();
    return <div data-testid="location-echo">{location.pathname + location.search}</div>;
}

describe('instance state presentation helpers', () => {
    it('maps diagnosis states to labels and tones', () => {
        expect(getInstanceStateLabel('NOT_DUE')).toBe('未到点火时间');
        expect(getInstanceStateLabel('PENDING_FIRE')).toBe('等待触发');
        expect(getInstanceStateLabel('MISSED')).toBe('疑似漏触发');
        expect(getInstanceStateLabel('SCHEDULE_DISABLED')).toBe('调度已停用');
        expect(getInstanceStateLabel('NO_SCHEDULE')).toBe('未配置调度');
        expect(getInstanceStateLabel('WAITING_UPSTREAM')).toBe('等待上游');
        expect(getInstanceStateLabel('GATE_TIMEOUT')).toBe('等待上游超时');
        expect(getInstanceStateLabel('PAUSED_BY_POLICY')).toBe('上一期失败已暂停');
        expect(getInstanceStateLabel('UNSYNCED')).toBe('未同步');
        expect(getInstanceStateLabel('NOT_FIRED')).toBe('未触发');
        expect(getInstanceStateLabel('SUCCESS')).toBe('成功');
        expect(getInstanceStateLabel('FAILED')).toBe('失败');

        expect(getInstanceStateTone('SUCCESS')).toBe('success');
        expect(getInstanceStateTone('MISSED')).toBe('failed');
        expect(getInstanceStateTone('GATE_TIMEOUT')).toBe('failed');
        expect(getInstanceStateTone('PAUSED_BY_POLICY')).toBe('failed');
        expect(getInstanceStateTone('WAITING_UPSTREAM')).toBe('warning');
        expect(getInstanceStateTone('PENDING_FIRE')).toBe('warning');
        expect(getInstanceStateTone('NOT_DUE')).toBe('neutral');
        expect(getInstanceStateTone('RUNNING')).toBe('running');
        expect(getInstanceStateTone('FAILED')).toBe('failed');

        expect(isActiveInstanceState('WAITING_UPSTREAM')).toBe(true);
        expect(isActiveInstanceState('PENDING_FIRE')).toBe(true);
        expect(isActiveInstanceState('RUNNING')).toBe(true);
        expect(isActiveInstanceState('SUCCESS')).toBe(false);
        expect(isActiveInstanceState('MISSED')).toBe(false);
    });
});

describe('OperationsInstancePage', () => {
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

        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis());

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
            labels: { owner: 'policy', wbdataParameterOverrideKeys: 'bizDate' },
            parameterResolutionStatus: 'AVAILABLE',
            parameters: [
                {
                    key: 'bizDate',
                    dataType: 'DATE',
                    value: '2026-06-07',
                    source: 'MANUAL_OVERRIDE',
                },
            ],
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
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    function renderPage(initialEntry = '/operations/instances?branch=feature%2Fpolicy-review&flowId=daily_policy&period=2026-06-07&execution=exec-1') {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[initialEntry]}>
                    <Routes>
                        <Route path="/operations/instances" element={<OperationsInstancePage />} />
                        <Route path="*" element={<LocationEcho />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
    }

    it('loads instance overview by default and switches to logs tab when inspecting a node', async () => {
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        expect(screen.getByText('feature/policy-review')).toBeTruthy();
        expect(screen.getByText('0 2 * * *')).toBeTruthy();
        expect(screen.getByText('Asia/Shanghai')).toBeTruthy();
        expect(screen.getByText('已启用')).toBeTruthy();
        expect(screen.getAllByText(formatLocalDateTime(new Date('2026-06-07T00:00:00Z'))).length).toBeGreaterThan(0);

        const overviewPanel = screen.getByRole('tabpanel', { name: '运行概览' });
        expect(within(overviewPanel).queryByRole('button', { name: '查看 flow_dag 日志' })).toBeNull();
        expect(within(overviewPanel).getByText(formatBrowserDateTime('2026-06-07T01:03:10Z'))).toBeTruthy();
        expect(within(overviewPanel).getByText('2m 8s')).toBeTruthy();
        expect(getOperationsExecutionLogsMock).not.toHaveBeenCalled();

        const summary = screen.getByLabelText('执行摘要');
        expect(within(summary).getByText('节点数').nextElementSibling?.textContent).toBe('2');

        fireEvent.click(within(overviewPanel).getByRole('button', { name: '查看 extract_policy 日志' }));

        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'extract_policy'));
        expect(await screen.findByText('extract finished')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '查看 load_policy 日志' }));
        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'load_policy'));
        expect(await screen.findByText('load failed on row 42')).toBeTruthy();
    });

    it('refreshes diagnosis, execution and logs from one action', async () => {
        renderPage();

        expect(await screen.findByRole('tabpanel', { name: '运行概览' })).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: '执行日志' }));
        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'load_policy'));
        const diagnosisCalls = getOperationsInstanceDiagnosisMock.mock.calls.length;
        const detailCalls = getOperationsExecutionMock.mock.calls.length;
        const logCalls = getOperationsExecutionLogsMock.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: '刷新当前实例' }));

        await waitFor(() => expect(getOperationsInstanceDiagnosisMock.mock.calls.length).toBeGreaterThan(diagnosisCalls));
        await waitFor(() => expect(getOperationsExecutionMock.mock.calls.length).toBeGreaterThan(detailCalls));
        await waitFor(() => expect(getOperationsExecutionLogsMock.mock.calls.length).toBeGreaterThan(logCalls));
    });

    it('reuses manual overrides only after explicit confirmation', async () => {
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

        expect(await screen.findByRole('heading', { name: '确认重跑任务' })).toBeTruthy();
        expect(rerunOperationsExecutionMock).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole('checkbox', { name: '沿用原执行的手动覆盖值' }));
        fireEvent.click(screen.getByRole('button', { name: '确认重跑' }));

        await waitFor(() => expect(rerunOperationsExecutionMock).toHaveBeenCalledWith(
            4,
            'exec-1',
            { reuseManualOverrides: true },
        ));
        expect(showSuccess).toHaveBeenCalledWith('已触发重跑');
    });

    it('shows empty state with reason when the period has no execution', async () => {
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            state: 'NOT_DUE',
            reason: '未到计划点火时间',
            plannedFireAt: '2026-06-08T00:00:00Z',
            executions: [],
        }));
        renderPage('/operations/instances?branch=feature%2Fpolicy-review&flowId=daily_policy&period=2026-06-08');

        expect(await screen.findByLabelText('无执行实例')).toBeTruthy();
        expect(screen.getAllByText('未到计划点火时间').length).toBeGreaterThan(0);
        expect(screen.getAllByText('未到点火时间').length).toBeGreaterThan(0);
        expect(getOperationsExecutionMock).not.toHaveBeenCalled();
    });

    it('switches between multiple executions of the same period', async () => {
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            state: 'SUCCESS',
            executions: [
                {
                    id: 'exec-2',
                    status: 'SUCCESS',
                    plannedAt: '2026-06-07T00:00:00Z',
                    createdAt: '2026-06-07T05:00:00Z',
                    startDate: '2026-06-07T05:00:02Z',
                    endDate: '2026-06-07T05:01:12Z',
                    durationMs: 70000,
                    rerun: true,
                },
                {
                    id: 'exec-1',
                    status: 'FAILED',
                    plannedAt: '2026-06-07T00:00:00Z',
                    createdAt: '2026-06-07T01:00:00Z',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: '2026-06-07T01:03:12Z',
                    durationMs: 190000,
                    rerun: false,
                },
            ],
        }));
        renderPage('/operations/instances?branch=feature%2Fpolicy-review&flowId=daily_policy&period=2026-06-07&execution=exec-1');

        expect(await screen.findByText('本期共 2 次执行')).toBeTruthy();
        expect(screen.getByText('手动重跑')).toBeTruthy();
        await waitFor(() => expect(getOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-1'));

        fireEvent.click(screen.getAllByRole('button', { name: /2026/ })[0]!);

        await waitFor(() => expect(getOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-2'));
    });

    it('opens upstream drawer with timing details and drills into accessible upstream', async () => {
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            state: 'WAITING_UPSTREAM',
            reason: '依赖闸门等待上游同期实例: 组二/task_b',
            upstreams: [
                {
                    groupId: 2,
                    groupName: '组二',
                    flowId: 'task_b',
                    namespace: 'g2-feature-policy-review',
                    scheduleKey: '2026-06-07',
                    state: 'NOT_FIRED',
                    satisfied: false,
                    accessible: true,
                    executionId: 'exec-b',
                    plannedAt: '2026-06-07T01:00:00Z',
                    startDate: '2026-06-07T01:00:05Z',
                    endDate: '2026-06-07T01:02:15Z',
                    durationMs: 130000,
                },
                {
                    groupId: 3,
                    groupName: null,
                    flowId: 'task_c',
                    namespace: 'g3-feature-policy-review',
                    scheduleKey: '2026-06-07',
                    state: 'SUCCESS',
                    satisfied: true,
                    accessible: false,
                    executionId: 'exec-c',
                },
            ],
        }));
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: /上游实例 \(2\)/ }));

        const drawer = await screen.findByRole('dialog', { name: '上游实例' });
        expect(within(drawer).getByText('组二 / task_b')).toBeTruthy();
        expect(within(drawer).getByText('task_c')).toBeTruthy();
        expect(within(drawer).getByText('未满足闸门')).toBeTruthy();
        expect(within(drawer).getByText('已满足闸门')).toBeTruthy();
        expect(within(drawer).getByText(formatBrowserDateTime('2026-06-07T01:00:00Z'))).toBeTruthy();
        expect(within(drawer).getByText(formatBrowserDateTime('2026-06-07T01:00:05Z'))).toBeTruthy();
        expect(within(drawer).getByText(formatBrowserDateTime('2026-06-07T01:02:15Z'))).toBeTruthy();
        expect(within(drawer).getByText('2m 10s')).toBeTruthy();
        expect(within(drawer).getByRole('button', { name: /task_c/ })).toHaveProperty('disabled', true);

        fireEvent.click(within(drawer).getByRole('button', { name: /task_b/ }));

        await waitFor(() => expect(getOperationsInstanceDiagnosisMock).toHaveBeenCalledWith(2, {
            branch: 'feature/policy-review',
            flowId: 'task_b',
            scheduleKey: '2026-06-07',
        }));
    });

    it('locates instance from execution id when address params are missing', async () => {
        render(
            <QueryClientProvider client={new QueryClient({
                defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
            })}>
                <MemoryRouter initialEntries={['/operations/instances?execution=exec-1']}>
                    <Routes>
                        <Route path="/operations/instances" element={<OperationsInstancePage />} />
                        <Route path="*" element={<LocationEcho />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        await waitFor(() => expect(getOperationsInstanceDiagnosisMock).toHaveBeenCalledWith(4, {
            executionId: 'exec-1',
        }));
        expect(await screen.findByText('daily_policy')).toBeTruthy();
    });

    it('displays execution parameters tab and returns to logs when selecting a node', async () => {
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
            stoppable: false,
            taskRuns: [
                {
                    taskId: 'load_policy',
                    status: 'FAILED',
                    startDate: '2026-06-07T01:01:02Z',
                    endDate: '2026-06-07T01:03:10Z',
                    durationMs: 128000,
                },
            ],
            inputs: { bizDate: '2026-06-07' },
            labels: { owner: 'policy', wbdataParameterOverrideKeys: 'bizDate' },
            parameterResolutionStatus: 'AVAILABLE',
            parameterSnapshotChanged: true,
            parameters: [
                {
                    key: 'bizDate',
                    dataType: 'DATE',
                    value: '2026-06-07',
                    source: 'MANUAL_OVERRIDE',
                },
                {
                    key: 'envTag',
                    dataType: 'STRING',
                    value: 'prod',
                    source: 'CONSTANT',
                },
            ],
        });
        renderPage();

        const paramsTab = await screen.findByRole('tab', { name: /运行参数/ });
        expect(paramsTab.textContent).toContain('2');
        fireEvent.click(paramsTab);

        const panel = await screen.findByRole('tabpanel', { name: '运行参数' });
        expect(within(panel).getByText('原执行之后任务的参数定义已更新，下方展示本次执行时的实际解析值。')).toBeTruthy();
        expect(within(panel).getByText('bizDate')).toBeTruthy();
        expect(within(panel).getByText('2026-06-07')).toBeTruthy();
        expect(within(panel).getByText('手动覆盖')).toBeTruthy();
        expect(within(panel).getByText('固定值')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /运行概览/ }));
        fireEvent.click(screen.getByRole('button', { name: '查看 load_policy 日志' }));
        expect(await screen.findByRole('tabpanel', { name: '执行日志' })).toBeTruthy();
    });

    it('renders NONE and UNAVAILABLE fallback states in parameters tab', async () => {
        getOperationsExecutionMock.mockResolvedValue({
            id: 'exec-1',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            branch: 'feature/policy-review',
            status: 'SUCCESS',
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:00:00Z',
            startDate: '2026-06-07T01:00:02Z',
            endDate: '2026-06-07T01:01:00Z',
            durationMs: 58000,
            rerunnable: false,
            stoppable: false,
            taskRuns: [],
            inputs: {},
            labels: {},
            parameterResolutionStatus: 'NONE',
            parameters: [],
        });
        renderPage();

        fireEvent.click(await screen.findByRole('tab', { name: /运行参数/ }));
        expect(await screen.findByText('本次执行未配置参数。')).toBeTruthy();

        cleanup();
        getOperationsExecutionMock.mockResolvedValue({
            id: 'exec-1',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            branch: 'feature/policy-review',
            status: 'SUCCESS',
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:00:00Z',
            startDate: '2026-06-07T01:00:02Z',
            endDate: '2026-06-07T01:01:00Z',
            durationMs: 58000,
            rerunnable: false,
            stoppable: false,
            taskRuns: [],
            inputs: { customParam: 'abc' },
            labels: {},
            parameterResolutionStatus: 'UNAVAILABLE',
            parameters: [],
        });
        renderPage();

        const paramsTab = await screen.findByRole('tab', { name: /运行参数/ });
        expect(paramsTab.textContent).toContain('1');
        fireEvent.click(paramsTab);

        const panel = await screen.findByRole('tabpanel', { name: '运行参数' });
        expect(within(panel).getByText('原执行的参数快照不可用，无法还原完整解析来源；以下为原始输入参数。')).toBeTruthy();
        expect(within(panel).getByText('customParam')).toBeTruthy();
        expect(within(panel).getByText('abc')).toBeTruthy();
    });

    it('focuses active task, toggles live refresh, and stops running execution', async () => {
        stopOperationsExecutionMock.mockResolvedValue(undefined);
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            state: 'RUNNING',
            executions: [
                {
                    id: 'exec-1',
                    status: 'RUNNING',
                    plannedAt: '2026-06-07T00:00:00Z',
                    createdAt: '2026-06-07T01:00:00Z',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: null,
                    durationMs: null,
                    rerun: false,
                },
            ],
        }));
        getOperationsExecutionMock.mockResolvedValue({
            id: 'exec-1',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            branch: 'feature/policy-review',
            status: 'RUNNING',
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:00:00Z',
            startDate: '2026-06-07T01:00:02Z',
            endDate: null,
            durationMs: null,
            rerunnable: false,
            stoppable: true,
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
                    status: 'RUNNING',
                    startDate: '2026-06-07T01:01:02Z',
                    endDate: null,
                    durationMs: null,
                },
            ],
            inputs: {},
            labels: {},
            parameterResolutionStatus: 'NONE',
            parameters: [],
        });
        renderPage();

        expect(await screen.findByRole('tabpanel', { name: '运行概览' })).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: '执行日志' }));
        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'load_policy'));

        const liveToggle = await screen.findByRole('button', { name: '自动刷新 5s' });
        expect(liveToggle.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(liveToggle);
        expect(liveToggle.getAttribute('aria-pressed')).toBe('false');
        expect(liveToggle.textContent).toContain('自动刷新已暂停');

        fireEvent.click(screen.getByRole('button', { name: '停止任务' }));
        expect(await screen.findByRole('heading', { name: '确认停止任务' })).toBeTruthy();
        expect(stopOperationsExecutionMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认停止' }));

        await waitFor(() => expect(stopOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-1'));
        expect(showSuccess).toHaveBeenCalledWith('已发送停止请求');
    });

    it('omits the period stepper, hides repeated taskId columns in single-node logs, and quiets zero-count level pills', async () => {
        renderPage();

        expect(await screen.findByRole('tabpanel', { name: '运行概览' })).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: '执行日志' }));
        expect(await screen.findByText('load failed on row 42')).toBeTruthy();

        expect(screen.queryByRole('group', { name: '业务期切换' })).toBeNull();
        expect(screen.queryByRole('button', { name: '上一期' })).toBeNull();
        expect(screen.queryByRole('button', { name: '下一期' })).toBeNull();

        expect(document.querySelector('.log-viewer--no-task')).toBeTruthy();
        expect(document.querySelector('.log-line-task')).toBeNull();

        const errorPill = screen.getByRole('button', { name: 'ERROR 1' });
        const warnPill = screen.getByRole('button', { name: 'WARN 0' });
        const infoPill = screen.getByRole('button', { name: 'INFO 0' });
        expect(errorPill.className).not.toContain('is-zero');
        expect(warnPill.className).toContain('is-zero');
        expect(infoPill.className).toContain('is-zero');

        fireEvent.click(errorPill);
        expect(errorPill.className).toContain('is-active');
    });

    it('renders auto-retry badges and RETRIED diagnosis status distinctly from manual reruns', async () => {
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            state: 'RETRIED',
            reason: '上次执行失败，正在等待系统自动重试',
            executions: [
                {
                    id: 'exec-2',
                    status: 'RETRIED',
                    plannedAt: '2026-06-07T00:00:00Z',
                    createdAt: '2026-06-07T01:05:00Z',
                    startDate: '2026-06-07T01:05:01Z',
                    endDate: '2026-06-07T01:05:10Z',
                    durationMs: 9000,
                    rerun: true,
                    rerunType: 'AUTO',
                    retryAttempt: 1,
                },
            ],
        }));
        getOperationsExecutionMock.mockResolvedValue({
            id: 'exec-2',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            branch: 'feature/policy-review',
            status: 'RETRIED',
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:05:00Z',
            startDate: '2026-06-07T01:05:01Z',
            endDate: '2026-06-07T01:05:10Z',
            durationMs: 9000,
            rerunnable: false,
            stoppable: false,
            taskRuns: [],
            inputs: {},
            labels: {},
            parameterResolutionStatus: 'NONE',
            parameters: [],
            rerun: true,
            rerunType: 'AUTO',
            retryAttempt: 1,
        });

        renderPage('/operations/instances?branch=feature%2Fpolicy-review&flowId=daily_policy&period=2026-06-07&execution=exec-2');

        expect(await screen.findByText('上次执行失败，正在等待系统自动重试')).toBeTruthy();
        expect(screen.getByText('已重试')).toBeTruthy();
        expect(screen.getByText('本次执行为自动重试')).toBeTruthy();
        expect(screen.getByText('自动重试 #1')).toBeTruthy();
    });

    it('renders partial rerun badge, skipped task status, and defaults logs focus to executed node', async () => {
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            state: 'SUCCESS',
            executions: [
                {
                    id: 'exec-partial',
                    status: 'SUCCESS',
                    plannedAt: '2026-06-07T00:00:00Z',
                    createdAt: '2026-06-07T01:15:00Z',
                    startDate: '2026-06-07T01:15:01Z',
                    endDate: '2026-06-07T01:15:30Z',
                    durationMs: 29000,
                    rerun: true,
                    rerunType: 'MANUAL',
                    retryAttempt: null,
                    partialRerun: true,
                    rerunSelectedTaskCount: 1,
                    rerunTotalTaskCount: 2,
                },
            ],
        }));
        getOperationsExecutionMock.mockResolvedValue({
            id: 'exec-partial',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            branch: 'feature/policy-review',
            status: 'SUCCESS',
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:15:00Z',
            startDate: '2026-06-07T01:15:01Z',
            endDate: '2026-06-07T01:15:30Z',
            durationMs: 29000,
            rerunnable: false,
            stoppable: false,
            taskRuns: [
                {
                    taskId: 'extract_policy',
                    status: 'SKIPPED',
                    startDate: '2026-06-07T01:15:01Z',
                    endDate: '2026-06-07T01:15:01Z',
                    durationMs: 0,
                },
                {
                    taskId: 'load_policy',
                    status: 'SUCCESS',
                    startDate: '2026-06-07T01:15:02Z',
                    endDate: '2026-06-07T01:15:30Z',
                    durationMs: 28000,
                },
            ],
            inputs: { wbdata_rerun_tasks: 'load_policy' },
            labels: { wbdataRerunSelectedCount: '1', wbdataRerunTotalCount: '2' },
            parameterResolutionStatus: 'NONE',
            parameters: [],
            rerun: true,
            rerunType: 'MANUAL',
            retryAttempt: null,
            partialRerun: true,
            rerunSelectedTaskCount: 1,
            rerunTotalTaskCount: 2,
        });

        renderPage('/operations/instances?branch=feature%2Fpolicy-review&flowId=daily_policy&period=2026-06-07&execution=exec-partial');

        expect(await screen.findByText('手动重跑 · 1/2')).toBeTruthy();
        expect(screen.getByText('已跳过')).toBeTruthy();
        const summary = screen.getByLabelText('执行摘要');
        expect(within(summary).getByText('节点数').nextElementSibling?.textContent).toBe('1 / 2（1 已跳过）');
        expect(getOperationsExecutionLogsMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('tab', { name: '执行日志' }));
        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-partial', 'load_policy'));
    });

    it('confirms mark-success on failed execution and renders FORCE_SUCCESS banner with preserved failed nodes and error logs', async () => {
        markOperationsExecutionSuccessMock.mockResolvedValue(undefined);
        renderPage();

        const markBtn = await screen.findByRole('button', { name: '置成功' });
        fireEvent.click(markBtn);

        expect(await screen.findByRole('heading', { name: '确认置成功' })).toBeTruthy();
        expect(markOperationsExecutionSuccessMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认置成功' }));
        await waitFor(() => expect(markOperationsExecutionSuccessMock).toHaveBeenCalledWith(4, 'exec-1'));
        expect(showSuccess).toHaveBeenCalledWith('已置为成功');

        cleanup();
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            state: 'FORCE_SUCCESS',
            executions: [
                {
                    id: 'exec-1',
                    status: 'FORCE_SUCCESS',
                    plannedAt: '2026-06-07T00:00:00Z',
                    createdAt: '2026-06-07T01:00:00Z',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: '2026-06-07T01:03:12Z',
                    durationMs: 190000,
                    rerun: false,
                },
            ],
        }));
        getOperationsExecutionMock.mockResolvedValue({
            id: 'exec-1',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            branch: 'feature/policy-review',
            status: 'FORCE_SUCCESS',
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:00:00Z',
            startDate: '2026-06-07T01:00:02Z',
            endDate: '2026-06-07T01:03:12Z',
            durationMs: 190000,
            rerunnable: false,
            stoppable: false,
            markableSuccess: false,
            forceSuccess: true,
            forceSuccessBy: '系统管理员',
            forceSuccessAt: '2026-06-07T01:10:00Z',
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
            inputs: {},
            labels: {},
            parameterResolutionStatus: 'NONE',
            parameters: [],
        });

        renderPage();

        expect(await screen.findByText('人工置成功')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '重跑任务' })).toBeNull();
        expect(screen.queryByRole('button', { name: '置成功' })).toBeNull();
        expect(screen.getByText(/已人工置成功（操作人：系统管理员/)).toBeTruthy();
        expect(screen.getByText(new RegExp(formatBrowserDateTime('2026-06-07T01:10:00Z')))).toBeTruthy();

        const overviewPanel = screen.getByRole('tabpanel', { name: '运行概览' });
        expect(within(overviewPanel).getByText('失败')).toBeTruthy();
        fireEvent.click(within(overviewPanel).getByRole('button', { name: '查看 load_policy 日志' }));
        expect(await screen.findByText('load failed on row 42')).toBeTruthy();
    });

    it('shows full DAG nodes including NOT_RUN downstream, supports list/DAG toggle, opens SQL & Transfer snapshots, and navigates to offline workbench', async () => {
        getOperationsInstanceDiagnosisMock.mockResolvedValue(buildDiagnosis({
            flowId: 'crm_ods_daily_extract',
            branch: 'feature/policy-review',
            flowPath: '_flows/crm_ods_daily_extract/flow.yaml',
        }));
        getOperationsExecutionMock.mockResolvedValue({
            id: 'exec-1',
            namespace: 'g4-feature-policy-review',
            flowId: 'crm_ods_daily_extract',
            branch: 'feature/policy-review',
            status: 'FAILED',
            plannedAt: '2026-06-07T00:00:00Z',
            createdAt: '2026-06-07T01:00:00Z',
            startDate: '2026-06-07T01:00:02Z',
            endDate: '2026-06-07T01:03:12Z',
            durationMs: 190000,
            rerunnable: true,
            stoppable: false,
            flowPath: '_flows/crm_ods_daily_extract/flow.yaml',
            taskRuns: [
                {
                    taskId: 'transfer_node_1',
                    status: 'FAILED',
                    startDate: '2026-06-07T01:00:03Z',
                    endDate: '2026-06-07T01:01:00Z',
                    durationMs: 57000,
                },
            ],
            graphNodes: [
                {
                    taskId: 'transfer_node_1',
                    kind: 'TRANSFER',
                    dataSourceType: null,
                    status: 'FAILED',
                    startDate: '2026-06-07T01:00:03Z',
                    endDate: '2026-06-07T01:01:00Z',
                    durationMs: 57000,
                    hasCodeSnapshot: true,
                },
                {
                    taskId: 'mysql_node_2',
                    kind: 'MYSQL',
                    dataSourceType: 'MYSQL',
                    status: 'NOT_RUN',
                    startDate: null,
                    endDate: null,
                    durationMs: null,
                    hasCodeSnapshot: true,
                },
                {
                    taskId: 'mysql_node_3',
                    kind: 'MYSQL',
                    dataSourceType: 'MYSQL',
                    status: 'NOT_RUN',
                    startDate: null,
                    endDate: null,
                    durationMs: null,
                    hasCodeSnapshot: true,
                },
            ],
            graphEdges: [
                { source: 'transfer_node_1', target: 'mysql_node_2' },
                { source: 'mysql_node_2', target: 'mysql_node_3' },
            ],
            inputs: {},
            labels: {},
            parameterResolutionStatus: 'NONE',
            parameters: [],
        });

        getOperationsExecutionNodeSnapshotMock.mockImplementation(async (_groupId, _execId, taskId) => {
            if (taskId === 'mysql_node_2') {
                return {
                    executionId: 'exec-1',
                    taskId: 'mysql_node_2',
                    kind: 'MYSQL',
                    dataSourceType: 'MYSQL',
                    dataSourceId: 11,
                    dataSourceName: 'CRM MySQL',
                    scriptPath: 'scripts/crm/mysql_node_2.sql',
                    snapshotSource: 'EXECUTION_COMMIT',
                    snapshotCommitSha: '0123456789abcdef0123456789abcdef01234567',
                    exactSnapshot: true,
                    snapshotNotice: null,
                    contentAvailable: true,
                    rawContent: 'SELECT * FROM orders WHERE dt = ^[biz_date];',
                    renderedContent: "SELECT * FROM orders WHERE dt = '2026-06-07';",
                    renderNote: '参数已按本次执行实际值代入预览。',
                    renderError: null,
                    referencedParameters: [
                        { key: 'biz_date', dataType: 'STRING', value: '2026-06-07', source: 'SYSTEM_TIME' },
                    ],
                    transfer: null,
                };
            }
            return {
                executionId: 'exec-1',
                taskId: 'transfer_node_1',
                kind: 'TRANSFER',
                dataSourceType: null,
                dataSourceId: null,
                dataSourceName: null,
                scriptPath: 'transfers/crm/transfer_node_1.transfer.json',
                snapshotSource: 'CURRENT_ONLINE',
                snapshotCommitSha: null,
                exactSnapshot: false,
                snapshotNotice: '未能定位本次执行对应的历史代码提交，当前展示线上最新内容。',
                contentAvailable: true,
                rawContent: '{}',
                renderedContent: null,
                renderNote: null,
                renderError: null,
                referencedParameters: [],
                transfer: {
                    source: {
                        dataSourceId: 11,
                        dataSourceName: 'CRM MySQL',
                        dataSourceType: 'MYSQL',
                        database: 'crm_demo',
                        table: 'user',
                        whereRaw: null,
                        whereRendered: null,
                    },
                    target: {
                        dataSourceId: 12,
                        dataSourceName: 'Hive ODS',
                        dataSourceType: 'HIVE',
                        database: 'ods_crm',
                        table: 'ods_user_all_d',
                        whereRaw: null,
                        whereRendered: null,
                    },
                    writeMode: 'overwrite_partition',
                    fieldMappings: [
                        {
                            target: 'user_id',
                            kind: 'source_field',
                            source: 'user_id',
                            expressionRaw: null,
                            expressionRendered: null,
                            valueRaw: null,
                            valueRendered: null,
                        },
                    ],
                    partitions: [],
                    preSqlRaw: [],
                    preSqlRendered: [],
                    postSqlRaw: [],
                    postSqlRendered: [],
                },
            };
        });

        renderPage('/operations/instances?branch=feature%2Fpolicy-review&flowId=crm_ods_daily_extract&period=2026-06-07&execution=exec-1');

        const overviewPanel = await screen.findByRole('tabpanel', { name: '运行概览' });
        const summary = screen.getByLabelText('执行摘要');
        expect(within(summary).getByText('节点数').nextElementSibling?.textContent).toBe('1 / 3（2 未执行）');
        expect(within(overviewPanel).getByText('transfer_node_1')).toBeTruthy();
        expect(within(overviewPanel).getByText('mysql_node_2')).toBeTruthy();
        expect(within(overviewPanel).getByText('mysql_node_3')).toBeTruthy();
        expect(within(overviewPanel).getAllByText('未执行（上游失败）')).toHaveLength(2);
        expect((within(overviewPanel).getByRole('button', { name: '查看 mysql_node_2 日志' }) as HTMLButtonElement).disabled).toBe(true);

        // Open SQL snapshot drawer and switch between rendered SQL and template SQL
        const sqlButtons = within(overviewPanel).getAllByRole('button', { name: '查看 SQL' });
        fireEvent.click(sqlButtons[0]);

        const sqlDrawer = await screen.findByRole('dialog', { name: 'mysql_node_2 节点执行快照' });
        expect(await within(sqlDrawer).findByText("SELECT * FROM orders WHERE dt = '2026-06-07';")).toBeTruthy();
        expect(within(sqlDrawer).getByText(/^执行时快照/)).toBeTruthy();
        fireEvent.click(within(sqlDrawer).getByRole('tab', { name: 'SQL 模板' }));
        expect(within(sqlDrawer).getByText('SELECT * FROM orders WHERE dt = ^[biz_date];')).toBeTruthy();
        fireEvent.click(within(sqlDrawer).getByRole('button', { name: '关闭节点快照' }));

        // Switch to DAG view and open Transfer config snapshot from DAG inspector
        fireEvent.click(screen.getByRole('button', { name: 'DAG 图' }));
        expect(screen.getByText('共 3 个节点 · 1 失败 · 2 未执行')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '查看配置' }));

        const transferDrawer = await screen.findByRole('dialog', { name: 'transfer_node_1 节点执行快照' });
        expect(await within(transferDrawer).findByText('crm_demo.user')).toBeTruthy();
        expect(within(transferDrawer).getByText('当前线上版本')).toBeTruthy();
        expect(within(transferDrawer).getByText('ods_crm.ods_user_all_d')).toBeTruthy();
        fireEvent.click(within(transferDrawer).getByRole('button', { name: '关闭节点快照' }));

        // Navigate to Offline Workbench
        fireEvent.click(screen.getByRole('button', { name: '在离线开发中打开' }));
        expect(await screen.findByTestId('location-echo')).toBeTruthy();
        expect(screen.getByTestId('location-echo').textContent).toBe(
            '/offline?flowPath=_flows%2Fcrm_ods_daily_extract%2Fflow.yaml&branch=feature%2Fpolicy-review',
        );
    });
});
