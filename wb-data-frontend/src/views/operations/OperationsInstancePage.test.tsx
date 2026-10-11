import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    getOperationsInstanceDiagnosis,
    rerunOperationsExecution,
    type OperationsInstanceDiagnosis,
} from '../../api/operations';
import { formatLocalDateTime } from '../../lib/dateTime';
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
    getOperationsInstanceDiagnosis: vi.fn(),
    rerunOperationsExecution: vi.fn(),
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
const getOperationsInstanceDiagnosisMock = vi.mocked(getOperationsInstanceDiagnosis);
const rerunOperationsExecutionMock = vi.mocked(rerunOperationsExecution);

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

    it('loads instance diagnosis and focuses failed task logs', async () => {
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        expect(screen.getByText('feature/policy-review')).toBeTruthy();
        expect(screen.getByText('2026-06-07')).toBeTruthy();
        expect(screen.getByText('0 2 * * *')).toBeTruthy();
        expect(screen.getByText('Asia/Shanghai')).toBeTruthy();
        expect(screen.getByText('已启用')).toBeTruthy();
        expect(screen.getAllByText(formatLocalDateTime(new Date('2026-06-07T00:00:00Z'))).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: '查看 flow_dag 日志' })).toBeNull();
        const summary = screen.getByLabelText('执行摘要');
        expect(within(summary).getByText('节点数').nextElementSibling?.textContent).toBe('2');
        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'load_policy'));
        expect(await screen.findByText('load failed on row 42')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '查看 extract_policy 日志' }));

        await waitFor(() => expect(getOperationsExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'extract_policy'));
        expect(await screen.findByText('extract finished')).toBeTruthy();
    });

    it('refreshes diagnosis, execution and logs from one action', async () => {
        renderPage();

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
        fireEvent.click(screen.getByRole('checkbox', { name: '沿用原执行的手动覆盖值' }));
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
        expect(screen.getByText('重跑')).toBeTruthy();
        await waitFor(() => expect(getOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-1'));

        fireEvent.click(screen.getAllByRole('button', { name: /2026/ })[0]!);

        await waitFor(() => expect(getOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-2'));
    });

    it('opens upstream drawer and drills into accessible upstream', async () => {
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
                    executionId: null,
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
});
