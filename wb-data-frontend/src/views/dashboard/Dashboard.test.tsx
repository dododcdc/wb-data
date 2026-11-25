import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopOperationsExecution } from '../../api/operations';
import { getWorkspaceSummary, type WorkspaceSummaryResponse } from '../../api/workspace';
import * as SimpleSelectModule from '../../components/SimpleSelect';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useAuthStore } from '../../utils/auth';
import { LAST_DATASOURCE_STORAGE_KEY } from '../../constants/queryStorage';
import Dashboard from './Dashboard';

const { showSuccess, showError } = vi.hoisted(() => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('../../api/workspace', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../api/workspace')>();
    return {
        ...actual,
        getWorkspaceSummary: vi.fn(),
    };
});

vi.mock('../../api/operations', () => ({
    stopOperationsExecution: vi.fn(),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({ showSuccess, showError }),
}));

const getWorkspaceSummaryMock = vi.mocked(getWorkspaceSummary);
const stopOperationsExecutionMock = vi.mocked(stopOperationsExecution);

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderDashboard() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <TooltipProvider>
                <MemoryRouter initialEntries={['/']}>
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="*" element={<LocationProbe />} />
                    </Routes>
                </MemoryRouter>
            </TooltipProvider>
        </QueryClientProvider>,
    );
}

function buildFullSummary(overrides: Partial<WorkspaceSummaryResponse> = {}): WorkspaceSummaryResponse {
    return {
        groupId: 1,
        groupName: '电商核心数仓',
        role: 'GROUP_ADMIN',
        onboarding: false,
        datasources: {
            total: 12,
            enabledCount: 10,
            byType: [
                { type: 'MYSQL', count: 5 },
                { type: 'HIVE', count: 3 },
                { type: 'POSTGRESQL', count: 2 },
                { type: 'CLICKHOUSE', count: 2 },
            ],
            items: [
                {
                    id: 101,
                    name: 'prod_order_mysql',
                    type: 'MYSQL',
                    description: '核心订单库',
                    databaseName: 'order_db',
                    status: 'ENABLED',
                },
                {
                    id: 102,
                    name: 'dwh_hive_prod',
                    type: 'HIVE',
                    description: '离线数仓',
                    databaseName: 'dw_prod',
                    status: 'ENABLED',
                },
            ],
        },
        offline: {
            repoInitialized: true,
            branch: 'main',
            workingTreeBranch: 'main',
            availableBranches: ['main'],
            dirty: true,
            ahead: true,
            hasRemote: true,
            hasUpstream: true,
            headCommitId: 'abc1234',
            headCommitMessage: 'fix(dwd): 补齐退款口径',
            headCommitAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            flowCount: 1284,
            scheduledFlowCount: 846,
            dirtyFlowCount: 2,
            recentFlows: [
                {
                    path: '_flows/ods/ods_order_pay_sync/flow.yaml',
                    name: 'ods_order_pay_sync',
                    directory: '_flows/ods/',
                    scheduleState: 'ENABLED',
                    schedulePeriod: 'DAILY',
                    dirty: true,
                },
                {
                    path: '_flows/dwd/dwd_trade_detail_di/flow.yaml',
                    name: 'dwd_trade_detail_di',
                    directory: '_flows/dwd/',
                    scheduleState: 'ENABLED',
                    schedulePeriod: 'DAILY',
                    dirty: false,
                },
            ],
        },
        operations: {
            available: true,
            errorMessage: null,
            selectedBranch: 'main',
            branchSynced: true,
            availableBranches: ['main'],
            counts: {
                total: 24,
                success: 20,
                failed: 2,
                active: 2,
                stopped: 0,
            },
            attentionExecutions: [
                {
                    id: 'exec-fail-1',
                    namespace: 'g1-main',
                    flowId: 'ods_order_pay_sync',
                    branch: 'main',
                    status: 'FAILED',
                    plannedAt: '2026-11-25T02:00:00Z',
                    createdAt: '2026-11-25T02:00:01Z',
                    startDate: '2026-11-25T02:00:04Z',
                    endDate: '2026-11-25T02:00:46Z',
                    durationMs: 42000,
                    rerunnable: true,
                    stoppable: false,
                    rerun: false,
                },
                {
                    id: 'exec-run-1',
                    namespace: 'g1-main',
                    flowId: 'ads_gmv_hourly_agg',
                    branch: 'main',
                    status: 'RUNNING',
                    plannedAt: '2026-11-25T14:00:00Z',
                    createdAt: '2026-11-25T14:00:01Z',
                    startDate: '2026-11-25T14:00:02Z',
                    endDate: null,
                    durationMs: null,
                    rerunnable: false,
                    stoppable: true,
                    rerun: false,
                },
            ],
            recentExecutions: [
                {
                    id: 'exec-fail-1',
                    namespace: 'g1-main',
                    flowId: 'ods_order_pay_sync',
                    branch: 'main',
                    status: 'FAILED',
                    plannedAt: '2026-11-25T02:00:00Z',
                    createdAt: '2026-11-25T02:00:01Z',
                    startDate: '2026-11-25T02:00:04Z',
                    endDate: '2026-11-25T02:00:46Z',
                    durationMs: 42000,
                    rerunnable: true,
                    stoppable: false,
                    rerun: false,
                },
                {
                    id: 'exec-ok-1',
                    namespace: 'g1-main',
                    flowId: 'dwd_member_profile_df',
                    branch: 'main',
                    status: 'SUCCESS',
                    plannedAt: '2026-11-25T01:00:00Z',
                    createdAt: '2026-11-25T01:00:01Z',
                    startDate: '2026-11-25T01:00:03Z',
                    endDate: '2026-11-25T01:06:51Z',
                    durationMs: 408000,
                    rerunnable: true,
                    stoppable: false,
                    rerun: false,
                },
            ],
        },
        parameters: { activeCount: 6 },
        gitSync: {
            configured: true,
            enabledCount: 1,
            latestBranch: 'main',
            latestStatus: 'SUCCESS',
            latestSyncAt: new Date(Date.now() - 5 * 60_000).toISOString(),
            latestMessage: 'ok',
        },
        members: { totalCount: 5 },
        ...overrides,
    };
}

describe('Dashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        vi.spyOn(SimpleSelectModule, 'SimpleSelect').mockImplementation(
            ({ value, options, onChange, ariaLabel, className }) => (
                <select
                    aria-label={ariaLabel}
                    className={className}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            ),
        );
        useAuthStore.setState({
            token: 'test-token',
            userInfo: { id: 10, username: 'linchen', displayName: '林晨', systemRole: 'USER' },
            systemAdmin: false,
            currentGroup: { id: 1, name: '电商核心数仓', description: '', role: 'GROUP_ADMIN' },
            accessibleGroups: [{ id: 1, name: '电商核心数仓', description: '', role: 'GROUP_ADMIN' }],
            permissions: [
                'datasource.read',
                'datasource.write',
                'query.use',
                'query.export',
                'offline.read',
                'offline.write',
                'parameter.read',
                'member.read',
                'group.settings',
            ],
            contextLoaded: true,
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('renders workspace home with tabs, deep links, and stop execution confirmation', async () => {
        getWorkspaceSummaryMock.mockResolvedValue(buildFullSummary());
        stopOperationsExecutionMock.mockResolvedValue(undefined);

        renderDashboard();

        expect(await screen.findByRole('heading', { name: '电商核心数仓' })).toBeTruthy();
        expect(screen.getByText('1,284')).toBeTruthy();
        expect(screen.getByText('Kestra 同步（管理员）')).toBeTruthy();

        const table = screen.getByRole('table', { name: '近 24 小时执行动态列表' });
        expect(within(table).getByText('ods_order_pay_sync')).toBeTruthy();
        expect(within(table).getByText('ads_gmv_hourly_agg')).toBeTruthy();
        expect(within(table).queryByText('dwd_member_profile_df')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: /最近执行/ }));
        expect(within(table).getByText('dwd_member_profile_df')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /待关注/ }));
        fireEvent.click(screen.getByRole('button', { name: '停止 ads_gmv_hourly_agg' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('停止运行中的任务')).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: '确认停止' }));

        await waitFor(() => {
            expect(stopOperationsExecutionMock).toHaveBeenCalledWith(1, 'exec-run-1');
            expect(showSuccess).toHaveBeenCalledWith('已停止执行');
        });

        const recentFlowLink = screen.getByRole('link', { name: /dwd_trade_detail_di/ });
        expect(recentFlowLink.getAttribute('href')).toBe(
            '/offline?flowPath=_flows%2Fdwd%2Fdwd_trade_detail_di%2Fflow.yaml',
        );

        expect(screen.queryByRole('combobox', { name: '切换首页查看分支' })).toBeNull();
        expect(screen.getByText('main 分支 · 846 个已启用周期调度')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /近 24h 失败/ }));
        expect((await screen.findByTestId('location-probe')).textContent).toBe('/operations?status=FAILED&branch=main');
    });

    it('uses global branch selector in header and handles unsynced working-tree branches', async () => {
        getWorkspaceSummaryMock.mockImplementation(async (_groupId, branch) => {
            if (branch === 'feature/policy-review') {
                return buildFullSummary({
                    offline: {
                        ...buildFullSummary().offline!,
                        branch: 'feature/policy-review',
                        workingTreeBranch: 'feature/policy-review',
                        availableBranches: ['main', 'feature/policy-review'],
                        flowCount: 16,
                        scheduledFlowCount: 5,
                        dirtyFlowCount: 4,
                    },
                    operations: {
                        available: true,
                        errorMessage: null,
                        selectedBranch: 'feature/policy-review',
                        branchSynced: false,
                        availableBranches: ['main'],
                        counts: { total: 0, success: 0, failed: 0, active: 0, stopped: 0 },
                        attentionExecutions: [],
                        recentExecutions: [],
                    },
                });
            }
            return buildFullSummary({
                offline: {
                    ...buildFullSummary().offline!,
                    branch: 'main',
                    workingTreeBranch: 'feature/policy-review',
                    availableBranches: ['main', 'feature/policy-review'],
                    flowCount: 12,
                    scheduledFlowCount: 8,
                    dirtyFlowCount: 4,
                },
                operations: {
                    ...buildFullSummary().operations!,
                    selectedBranch: 'main',
                    branchSynced: true,
                    availableBranches: ['main'],
                },
            });
        });

        renderDashboard();

        const branchSelect = (await screen.findByRole('combobox', { name: '切换首页查看分支' })) as HTMLSelectElement;
        expect(branchSelect.value).toBe('main');
        expect(getWorkspaceSummaryMock).toHaveBeenCalledWith(1, undefined);
        const offlineCard = screen.getByRole('button', { name: /离线任务与调度/ });
        expect(within(offlineCard).getByText('12')).toBeTruthy();
        expect(within(offlineCard).getByText('main 分支 · 8 个已启用周期调度')).toBeTruthy();
        expect(screen.getByText('开发工作区')).toBeTruthy();
        expect(screen.getByText('feature/policy-review 工作区有 4 个任务草稿未提交')).toBeTruthy();

        fireEvent.change(branchSelect, { target: { value: 'feature/policy-review' } });
        await waitFor(() => {
            expect(getWorkspaceSummaryMock).toHaveBeenCalledWith(1, 'feature/policy-review');
        });
        expect(await within(offlineCard).findByText('16')).toBeTruthy();
        expect(within(offlineCard).getByText('feature/policy-review 分支 · 5 个已启用周期调度')).toBeTruthy();
        expect(screen.getByText('feature/policy-review 分支尚未启用 Kestra 同步')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '切换到 main 分支' }));
        await waitFor(() => {
            expect(getWorkspaceSummaryMock).toHaveBeenCalledWith(1, 'main');
        });
    });

    it('renders onboarding checklist and auto-checks step 1 when datasource exists', async () => {
        getWorkspaceSummaryMock.mockResolvedValue(
            buildFullSummary({
                groupName: '新业务分析组',
                onboarding: true,
                datasources: {
                    total: 1,
                    enabledCount: 1,
                    byType: [{ type: 'MYSQL', count: 1 }],
                    items: [
                        {
                            id: 101,
                            name: 'prod_order_mysql',
                            type: 'MYSQL',
                            description: null,
                            databaseName: 'order_db',
                            status: 'ENABLED',
                        },
                    ],
                },
                offline: {
                    repoInitialized: true,
                    branch: 'main',
                    workingTreeBranch: 'main',
                    availableBranches: ['main'],
                    dirty: false,
                    ahead: false,
                    hasRemote: false,
                    hasUpstream: false,
                    headCommitId: null,
                    headCommitMessage: null,
                    headCommitAt: null,
                    flowCount: 0,
                    scheduledFlowCount: 0,
                    dirtyFlowCount: 0,
                    recentFlows: [],
                },
                operations: {
                    available: true,
                    errorMessage: null,
                    selectedBranch: 'main',
                    branchSynced: true,
                    availableBranches: ['main'],
                    counts: { total: 0, success: 0, failed: 0, active: 0, stopped: 0 },
                    attentionExecutions: [],
                    recentExecutions: [],
                },
            }),
        );

        renderDashboard();

        expect(await screen.findByText('启动工作区：3 步完成首条任务链路')).toBeTruthy();
        expect(screen.getByText('已完成 1 / 3')).toBeTruthy();
        expect(screen.getByText('当前推荐')).toBeTruthy();
        expect(screen.getByRole('button', { name: '打开自助查询' })).toBeTruthy();
    });

    it('renders query-only home with type filter chips when offline permission is absent', async () => {
        localStorage.setItem(LAST_DATASOURCE_STORAGE_KEY, '101');
        useAuthStore.setState({
            permissions: ['datasource.read', 'query.use', 'query.export'],
        });
        getWorkspaceSummaryMock.mockResolvedValue(
            buildFullSummary({
                role: 'ANALYST',
                offline: null,
                operations: null,
                parameters: null,
                gitSync: null,
                members: null,
            }),
        );

        renderDashboard();

        expect(await screen.findByRole('heading', { name: '可查数据源' })).toBeTruthy();
        expect(screen.queryByText('近 24h 执行动态')).toBeNull();
        expect(screen.queryByText('继续工作')).toBeNull();

        const table = screen.getByRole('table', { name: '项目组可查数据源列表' });
        expect(within(table).getByText('prod_order_mysql')).toBeTruthy();
        expect(within(table).getByText('dwh_hive_prod')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Hive' }));
        expect(within(table).queryByText('prod_order_mysql')).toBeNull();
        expect(within(table).getByText('dwh_hive_prod')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '进入查询' }));
        expect((await screen.findByTestId('location-probe')).textContent).toBe('/query');
        expect(localStorage.getItem(LAST_DATASOURCE_STORAGE_KEY)).toBe('102');
    });

    it('renders appropriate no-group state for regular user vs system admin', async () => {
        useAuthStore.setState({
            currentGroup: null,
            accessibleGroups: [],
            permissions: [],
            systemAdmin: false,
            contextLoaded: true,
        });
        const firstRender = renderDashboard();
        expect(await screen.findByText('尚未加入任何项目组')).toBeTruthy();
        expect(screen.queryByRole('link', { name: /数据源/ })).toBeNull();
        firstRender.unmount();

        useAuthStore.setState({
            systemAdmin: true,
            currentGroup: null,
            contextLoaded: true,
        });
        renderDashboard();
        expect(await screen.findByRole('heading', { name: '系统管理工作台' })).toBeTruthy();
        expect(screen.getByRole('link', { name: /项目组管理/ }).getAttribute('href')).toBe('/groups');
        expect(screen.getByRole('link', { name: /用户管理/ }).getAttribute('href')).toBe('/users');
    });

    it('degrades only the operations panel when Kestra is unavailable', async () => {
        getWorkspaceSummaryMock.mockResolvedValue(
            buildFullSummary({
                operations: {
                    available: false,
                    errorMessage: '无法获取 Kestra 执行状态，请检查调度服务连接后重试',
                    selectedBranch: 'main',
                    branchSynced: false,
                    availableBranches: [],
                    counts: { total: 0, success: 0, failed: 0, active: 0, stopped: 0 },
                    attentionExecutions: [],
                    recentExecutions: [],
                },
            }),
        );

        renderDashboard();

        expect(await screen.findByText('无法获取 Kestra 执行状态，请检查调度服务连接后重试')).toBeTruthy();
        expect(screen.getByText('继续工作')).toBeTruthy();
        expect(screen.getByText('1,284')).toBeTruthy();
    });
});
