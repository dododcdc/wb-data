import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Activity,
    ArrowRight,
    ExternalLink,
    GitBranch,
    Layers,
    RefreshCw,
    Search,
    Square,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { stopOperationsExecution, type OperationsExecutionListItem } from '../../api/operations';
import type { WorkspaceSummaryResponse } from '../../api/workspace';
import { SimpleSelect } from '../../components/SimpleSelect';
import { getExecutionStatusLabel, isStoppable } from '../../components/execution/executionPresentation';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { formatTime } from '../../lib/dateTime';
import {
    dataSourceTypeBadgeClass,
    dataSourceTypeLabel,
    executionStatusTone,
    formatCount,
    formatDataSourceBreakdown,
    formatExecutionDuration,
    formatRelativeTime,
    formatScheduleMeta,
    gitSyncStatusInfo,
    resolveLastQueryContext,
    resolveRoleLabel,
    schedulePillInfo,
} from './dashboardUtils';

interface WorkspaceHomeProps {
    summary: WorkspaceSummaryResponse;
    canUseQuery: boolean;
    canWriteOffline: boolean;
    onBranchChange: (branch: string | undefined) => void;
    onRefresh: () => void;
    isRefreshing: boolean;
}

type ExecutionTab = 'attention' | 'recent';

export function WorkspaceHome({
    summary,
    canUseQuery,
    canWriteOffline,
    onBranchChange,
    onRefresh,
    isRefreshing,
}: WorkspaceHomeProps) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { showSuccess, showError } = useOperationFeedback();

    const offline = summary.offline!;
    const operations = summary.operations;
    const attentionExecutions = useMemo(
        () => operations?.attentionExecutions ?? [],
        [operations?.attentionExecutions],
    );
    const recentExecutions = useMemo(
        () => operations?.recentExecutions ?? [],
        [operations?.recentExecutions],
    );

    const [tabOverride, setTabOverride] = useState<ExecutionTab | null>(null);
    const activeTab: ExecutionTab = tabOverride ?? (attentionExecutions.length > 0 ? 'attention' : 'recent');
    const visibleExecutions = activeTab === 'attention' ? attentionExecutions : recentExecutions;

    const [stopTarget, setStopTarget] = useState<OperationsExecutionListItem | null>(null);
    const [pendingStopId, setPendingStopId] = useState<string | null>(null);

    const stopMutation = useMutation({
        mutationFn: (executionId: string) => stopOperationsExecution(summary.groupId, executionId),
        onMutate: (executionId) => {
            setPendingStopId(executionId);
        },
        onSuccess: () => {
            setStopTarget(null);
            showSuccess('已停止执行');
            void queryClient.invalidateQueries({ queryKey: ['workspace-summary', summary.groupId] });
        },
        onError: (error) => {
            showError(error, '停止执行失败');
        },
        onSettled: () => {
            setPendingStopId(null);
        },
    });

    const lastQueryContext = useMemo(
        () => resolveLastQueryContext(summary.datasources?.items),
        [summary.datasources?.items],
    );

    const selectedBranch = offline.branch ?? operations?.selectedBranch ?? null;
    const workingTreeBranch = offline.workingTreeBranch ?? null;
    const viewingWorkingTree = selectedBranch != null && workingTreeBranch != null && selectedBranch === workingTreeBranch;

    const branchOptions = useMemo(() => {
        const branchNames = new Set<string>(offline.availableBranches ?? []);
        if (selectedBranch) {
            branchNames.add(selectedBranch);
        }
        return Array.from(branchNames).map((branch) => ({ value: branch, label: branch }));
    }, [offline.availableBranches, selectedBranch]);
    const showGlobalBranchSelect = branchOptions.length > 1;
    const operationsSynced = Boolean(operations?.available && operations.branchSynced);
    const primarySyncedBranch = operations?.availableBranches?.[0] ?? null;

    const gitStatusPill = useMemo(() => {
        if (!offline.repoInitialized) {
            return { tone: 'neutral' as const, label: '仓库未初始化' };
        }
        if (!viewingWorkingTree) {
            return offline.ahead
                ? { tone: 'warning' as const, label: '有待推送提交' }
                : { tone: 'success' as const, label: '已同步' };
        }
        const parts: string[] = [];
        if (offline.dirtyFlowCount > 0) parts.push(`${offline.dirtyFlowCount} 处未提交`);
        else if (offline.dirty) parts.push('有未提交改动');
        if (offline.ahead) parts.push('有待推送提交');
        if (parts.length > 0) {
            return { tone: 'warning' as const, label: parts.join(' · ') };
        }
        return { tone: 'success' as const, label: '工作区已同步' };
    }, [offline.ahead, offline.dirty, offline.dirtyFlowCount, offline.repoInitialized, viewingWorkingTree]);

    const failedCount = operations?.counts.failed ?? 0;
    const activeCount = operations?.counts.active ?? 0;
    const successCount = operations?.counts.success ?? 0;
    const totalExecutions24h = operations?.counts.total ?? 0;

    const buildOperationsLink = (status?: string) => {
        const params = new URLSearchParams();
        if (status) {
            params.set('status', status);
        }
        if (operationsSynced && selectedBranch) {
            params.set('branch', selectedBranch);
        }
        const query = params.toString();
        return query ? `/operations?${query}` : '/operations';
    };

    const branchScopePrefix = selectedBranch ? `${selectedBranch} 分支 · ` : '';

    const executionColumns: DataListColumn<OperationsExecutionListItem>[] = [
        {
            key: 'flowId',
            header: '任务名称',
            primary: true,
            mono: true,
            truncate: true,
            cell: (row) => row.flowId,
        },
        {
            key: 'branch',
            header: '分支',
            mono: true,
            cell: (row) => row.branch,
        },
        {
            key: 'status',
            header: '状态',
            cell: (row) => (
                <StatusPill tone={executionStatusTone(row.status)}>
                    {getExecutionStatusLabel(row.status)}
                </StatusPill>
            ),
        },
        {
            key: 'time',
            header: '开始时间',
            mono: true,
            cell: (row) => formatTime(row.startDate ?? row.createdAt ?? row.plannedAt),
        },
        {
            key: 'duration',
            header: '耗时',
            mono: true,
            cell: (row) => formatExecutionDuration(row.durationMs),
        },
        {
            key: 'actions',
            header: '操作',
            align: 'right',
            cell: (row) => {
                const items: RowActionItem[] = [
                    {
                        key: 'detail',
                        label: '查看详情',
                        ariaLabel: `查看 ${row.flowId} 执行详情`,
                        icon: ExternalLink,
                        onClick: () => navigate(`/operations/executions/${encodeURIComponent(row.id)}`),
                    },
                ];
                if ((row.stoppable ?? isStoppable(row.status)) && canWriteOffline) {
                    items.push({
                        key: 'stop',
                        label: '停止执行',
                        ariaLabel: `停止 ${row.flowId}`,
                        icon: Square,
                        tone: 'danger',
                        pending: pendingStopId === row.id,
                        onClick: () => setStopTarget(row),
                    });
                }
                return <RowActions items={items} maxVisible={2} />;
            },
        },
    ];

    const listState = operations && !operations.available
        ? 'error'
        : visibleExecutions.length === 0
            ? 'empty'
            : 'ready';

    const syncInfo = summary.gitSync ? gitSyncStatusInfo(summary.gitSync.latestStatus) : null;

    return (
        <div className="wb-home-page animate-enter">
            {/* 1. PageHeader */}
            <header className="wb-page-header">
                <div className="wb-page-header-copy">
                    <h1 className="wb-page-title">{summary.groupName}</h1>
                    <div className="wb-page-meta">
                        <StatusPill tone="neutral" dot={false}>
                            {resolveRoleLabel(summary.role)}
                        </StatusPill>
                        {showGlobalBranchSelect ? (
                            <SimpleSelect
                                className="wb-home-branch-select"
                                ariaLabel="切换首页查看分支"
                                value={selectedBranch ?? branchOptions[0].value}
                                options={branchOptions}
                                onChange={(value) => {
                                    setTabOverride(null);
                                    onBranchChange(value);
                                }}
                            />
                        ) : selectedBranch ? (
                            <span className="wb-branch-chip">
                                <GitBranch size={12} aria-hidden="true" />
                                <span>{selectedBranch}</span>
                            </span>
                        ) : null}
                        <StatusPill tone={gitStatusPill.tone}>{gitStatusPill.label}</StatusPill>
                        {offline.headCommitMessage ? (
                            <span className="wb-commit-summary">
                                最近提交：{formatRelativeTime(offline.headCommitAt)} · {offline.headCommitMessage}
                            </span>
                        ) : null}
                    </div>
                </div>

                <div className="wb-page-actions">
                    {canUseQuery ? (
                        <Button variant="outline" onClick={() => navigate('/query')}>
                            <Search size={15} />
                            <span>新建 SQL 查询</span>
                        </Button>
                    ) : null}
                    <Button className="wb-btn-brand" onClick={() => navigate('/offline')}>
                        <Layers size={15} />
                        <span>进入离线开发</span>
                    </Button>
                </div>
            </header>

            {/* 2. MetricStrip */}
            <section
                className={`wb-metric-strip ${summary.datasources ? 'cols-4' : 'cols-3'}`}
                aria-label="工作区运行摘要"
            >
                <button
                    type="button"
                    className="wb-metric-cell"
                    onClick={() => navigate(operationsSynced ? buildOperationsLink('FAILED') : '/operations')}
                >
                    <div className="wb-metric-head">
                        <span className="wb-metric-label">近 24h 失败</span>
                        {!operations?.available ? (
                            <StatusPill tone="neutral">未连接</StatusPill>
                        ) : !operationsSynced ? (
                            <StatusPill tone="neutral">未同步</StatusPill>
                        ) : failedCount > 0 ? (
                            <StatusPill tone="danger">需排查</StatusPill>
                        ) : (
                            <StatusPill tone="success">无异常</StatusPill>
                        )}
                    </div>
                    <div className={`wb-metric-value ${operationsSynced && failedCount > 0 ? 'is-danger' : ''}`}>
                        {operationsSynced ? formatCount(failedCount) : '—'}
                    </div>
                    <div className="wb-metric-sub">
                        {!operations?.available
                            ? 'Kestra 暂不可达'
                            : !operationsSynced
                                ? `${selectedBranch ?? '当前'} 分支未启用 Kestra 同步`
                                : `${branchScopePrefix}点击筛选失败实例`}
                    </div>
                </button>

                <button
                    type="button"
                    className="wb-metric-cell"
                    onClick={() => navigate(operationsSynced ? buildOperationsLink('ACTIVE') : '/operations')}
                >
                    <div className="wb-metric-head">
                        <span className="wb-metric-label">进行中执行</span>
                        {!operations?.available ? (
                            <StatusPill tone="neutral">未连接</StatusPill>
                        ) : !operationsSynced ? (
                            <StatusPill tone="neutral">未同步</StatusPill>
                        ) : activeCount > 0 ? (
                            <StatusPill tone="info">执行中</StatusPill>
                        ) : (
                            <StatusPill tone="neutral">空闲</StatusPill>
                        )}
                    </div>
                    <div className="wb-metric-value">
                        {operationsSynced ? formatCount(activeCount) : '—'}
                    </div>
                    <div className="wb-metric-sub">
                        {!operations?.available
                            ? '点击前往运维中心'
                            : !operationsSynced
                                ? '仅已启用同步的分支会产生正式调度'
                                : `${branchScopePrefix}成功 ${formatCount(successCount)} / 共 ${formatCount(totalExecutions24h)} 条`}
                    </div>
                </button>

                <button
                    type="button"
                    className="wb-metric-cell"
                    onClick={() => navigate('/offline')}
                >
                    <div className="wb-metric-head">
                        <span className="wb-metric-label">离线任务与调度</span>
                        {viewingWorkingTree && (offline.dirtyFlowCount > 0 || offline.ahead) ? (
                            <StatusPill tone="warning">待发布</StatusPill>
                        ) : !viewingWorkingTree && offline.ahead ? (
                            <StatusPill tone="warning">待推送</StatusPill>
                        ) : (
                            <StatusPill tone="success">已同步</StatusPill>
                        )}
                    </div>
                    <div className="wb-metric-value">{formatCount(offline.flowCount)}</div>
                    <div className="wb-metric-sub">
                        {selectedBranch ? `${selectedBranch} 分支 · ` : ''}
                        {formatCount(offline.scheduledFlowCount)} 个已启用周期调度
                    </div>
                </button>

                {summary.datasources ? (
                    <button
                        type="button"
                        className="wb-metric-cell"
                        onClick={() => navigate('/datasources')}
                    >
                        <div className="wb-metric-head">
                            <span className="wb-metric-label">可用数据源</span>
                            <span className="wb-metric-link">管理连接</span>
                        </div>
                        <div className="wb-metric-value">
                            {formatCount(summary.datasources.enabledCount)}
                        </div>
                        <div className="wb-metric-sub">
                            {formatDataSourceBreakdown(summary.datasources.byType)}
                        </div>
                    </button>
                ) : null}
            </section>

            {/* 3. 主体双栏 */}
            <div className="wb-home-grid">
                {/* 左主栏：近 24h 执行动态 */}
                <section className="wb-section-panel" aria-label="近 24 小时执行动态">
                    <div className="wb-section-header">
                        <div className="wb-section-title-group">
                            <h2 className="wb-section-title">近 24h 执行动态</h2>
                            <div className="wb-tab-group" role="tablist" aria-label="执行动态筛选">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={activeTab === 'attention'}
                                    className={`wb-tab-btn${activeTab === 'attention' ? ' is-active' : ''}`}
                                    onClick={() => setTabOverride('attention')}
                                >
                                    待关注 ({attentionExecutions.length})
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={activeTab === 'recent'}
                                    className={`wb-tab-btn${activeTab === 'recent' ? ' is-active' : ''}`}
                                    onClick={() => setTabOverride('recent')}
                                >
                                    最近执行 ({recentExecutions.length})
                                </button>
                            </div>
                        </div>

                        <div className="wb-section-header-actions">
                            <button
                                type="button"
                                className="wb-inline-refresh-btn"
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                aria-label="刷新工作区摘要"
                            >
                                <RefreshCw size={14} className={isRefreshing ? 'wb-spin' : undefined} />
                            </button>
                            <Link className="wb-section-more-link" to={buildOperationsLink()}>
                                <span>查看全部运行</span>
                                <ArrowRight size={14} aria-hidden="true" />
                            </Link>
                        </div>
                    </div>

                    <DataList
                        className="wb-home-embedded-list"
                        rows={operationsSynced ? visibleExecutions : []}
                        columns={executionColumns}
                        rowKey={(row) => row.id}
                        ariaLabel="近 24 小时执行动态列表"
                        minWidth="580px"
                        state={operations && !operations.available ? 'error' : !operationsSynced ? 'empty' : listState}
                        isRefreshing={isRefreshing}
                        errorMessage={operations?.errorMessage ?? undefined}
                        errorAction={(
                            <Button variant="outline" size="sm" onClick={onRefresh}>
                                重试
                            </Button>
                        )}
                        emptyIcon={<Activity size={24} />}
                        emptyTitle={
                            !operationsSynced
                                ? `${selectedBranch ?? '当前'} 分支尚未启用 Kestra 同步`
                                : activeTab === 'attention'
                                    ? '近 24 小时暂无异常或运行中的任务'
                                    : '近 24 小时暂无执行记录'
                        }
                        emptyDescription={
                            !operationsSynced
                                ? '该分支当前仅用于开发调试，不会触发周期调度。可切回已同步分支查看运行，或在项目组设置中启用该分支同步。'
                                : activeTab === 'attention'
                                    ? `${selectedBranch ? `${selectedBranch} 分支` : '当前范围'}近 24 小时运行平稳，可切换「最近执行」或前往运维中心查看历史记录。`
                                    : `${selectedBranch ? `${selectedBranch} 分支` : '当前范围'}近 24 小时暂无执行，前往离线开发调试执行或开启周期调度后会展示在这里。`
                        }
                        emptyAction={
                            !operationsSynced ? (
                                primarySyncedBranch ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setTabOverride(null);
                                            onBranchChange(primarySyncedBranch);
                                        }}
                                    >
                                        切换到 {primarySyncedBranch} 分支
                                    </Button>
                                ) : summary.gitSync ? (
                                    <Button variant="outline" size="sm" onClick={() => navigate('/group-settings')}>
                                        前往项目组设置
                                    </Button>
                                ) : (
                                    <Button variant="outline" size="sm" onClick={() => navigate('/offline')}>
                                        前往离线开发
                                    </Button>
                                )
                            ) : activeTab === 'attention' && recentExecutions.length > 0 ? (
                                <Button variant="outline" size="sm" onClick={() => setTabOverride('recent')}>
                                    查看最近执行
                                </Button>
                            ) : (
                                <Button variant="outline" size="sm" onClick={() => navigate('/offline')}>
                                    前往离线开发
                                </Button>
                            )
                        }
                        onRowClick={(row) => navigate(`/operations/executions/${encodeURIComponent(row.id)}`)}
                        rowAriaLabel={(row) => `查看 ${row.flowId} 执行详情`}
                    />

                    {operationsSynced ? (
                        <div className="wb-section-footer">
                            <span>
                                {branchScopePrefix}近 24h 共 {formatCount(totalExecutions24h)} 条执行 · 成功 {formatCount(successCount)} 条
                            </span>
                            <span>展示前 {visibleExecutions.length} 条</span>
                        </div>
                    ) : null}
                </section>

                {/* 右辅栏 */}
                <aside className="wb-home-side">
                    {/* 继续工作 */}
                    <section className="wb-section-panel" aria-label="继续工作">
                        <div className="wb-section-header">
                            <div className="wb-section-title-group">
                                <h2 className="wb-section-title">继续工作</h2>
                                {workingTreeBranch ? (
                                    <span className="wb-branch-chip">
                                        <GitBranch size={12} aria-hidden="true" />
                                        <span>{workingTreeBranch}</span>
                                    </span>
                                ) : null}
                                {!viewingWorkingTree && workingTreeBranch ? (
                                    <span className="wb-workspace-hint">开发工作区</span>
                                ) : null}
                            </div>
                            <Link className="wb-section-more-link" to="/offline">
                                全部任务
                            </Link>
                        </div>

                        {offline.recentFlows.length > 0 ? (
                            <div className="wb-side-list">
                                {offline.recentFlows.map((flow) => {
                                    const pill = flow.dirty
                                        ? { tone: 'warning' as const, label: '未提交' }
                                        : schedulePillInfo(flow.scheduleState);
                                    return (
                                        <Link
                                            key={flow.path}
                                            className="wb-side-row"
                                            to={`/offline?flowPath=${encodeURIComponent(flow.path)}`}
                                        >
                                            <div className="wb-side-row-main">
                                                <span className="wb-side-row-title is-mono">{flow.name}</span>
                                                <span className="wb-side-row-meta">
                                                    {flow.directory} · {formatScheduleMeta(flow.scheduleState, flow.schedulePeriod)}
                                                </span>
                                            </div>
                                            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                                        </Link>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="wb-side-empty">
                                <p>当前工作区暂无离线任务</p>
                                <Button variant="outline" size="sm" onClick={() => navigate('/offline')}>
                                    创建任务
                                </Button>
                            </div>
                        )}

                        <div className="wb-section-footer is-muted">
                            <span>
                                {offline.dirtyFlowCount > 0
                                    ? `${workingTreeBranch ? `${workingTreeBranch} ` : ''}工作区有 ${offline.dirtyFlowCount} 个任务草稿未提交`
                                    : viewingWorkingTree && offline.ahead
                                        ? '本地已有已提交版本待推送至远端'
                                        : `${workingTreeBranch ? `${workingTreeBranch} ` : ''}工作区与本地提交一致`}
                            </span>
                            <Link className="wb-section-more-link" to="/offline">
                                {offline.dirtyFlowCount > 0 ? '前往提交' : '打开工作台'}
                            </Link>
                        </div>
                    </section>

                    {/* 工作区入口 */}
                    <section className="wb-section-panel" aria-label="工作区入口">
                        <div className="wb-section-header">
                            <h2 className="wb-section-title">工作区入口</h2>
                        </div>

                        <div className="wb-side-list">
                            {canUseQuery ? (
                                <Link className="wb-side-row" to="/query">
                                    <div className="wb-side-row-main">
                                        <span className="wb-side-row-title">自助查询</span>
                                        <span className="wb-side-row-meta">
                                            {lastQueryContext
                                                ? `${lastQueryContext.fromHistory ? '上次：' : '可用：'}${lastQueryContext.dataSource.name}${lastQueryContext.databaseName ? ` / ${lastQueryContext.databaseName}` : ''}`
                                                : '编写、格式化并导出 SQL 查询结果'}
                                        </span>
                                    </div>
                                    <span className="wb-side-row-link">继续查询</span>
                                </Link>
                            ) : null}

                            {summary.datasources ? (
                                <Link className="wb-side-row" to="/datasources">
                                    <div className="wb-side-row-main">
                                        <span className="wb-side-row-title">数据源管理</span>
                                        <div className="wb-type-badge-row">
                                            {summary.datasources.byType.length > 0 ? (
                                                summary.datasources.byType.slice(0, 4).map((item) => (
                                                    <span
                                                        key={item.type}
                                                        className={dataSourceTypeBadgeClass(item.type)}
                                                    >
                                                        {dataSourceTypeLabel(item.type)}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="wb-side-row-meta">登记并测试数据库连接</span>
                                            )}
                                        </div>
                                    </div>
                                    <span className="wb-side-row-count">
                                        {formatCount(summary.datasources.total)}
                                    </span>
                                </Link>
                            ) : null}

                            {summary.parameters ? (
                                <Link className="wb-side-row" to="/parameters">
                                    <div className="wb-side-row-main">
                                        <span className="wb-side-row-title">参数组</span>
                                        <span className="wb-side-row-meta">统一时间基准与多版本快照</span>
                                    </div>
                                    <span className="wb-side-row-meta">
                                        {formatCount(summary.parameters.activeCount)} 生效
                                    </span>
                                </Link>
                            ) : null}

                            {summary.gitSync && syncInfo ? (
                                <Link className="wb-side-row" to="/group-settings">
                                    <div className="wb-side-row-main">
                                        <span className="wb-side-row-title">Kestra 同步（管理员）</span>
                                        <span className="wb-side-row-meta">
                                            {summary.gitSync.configured
                                                ? `${summary.gitSync.latestBranch ?? 'main'} · ${summary.gitSync.latestSyncAt ? `${formatRelativeTime(summary.gitSync.latestSyncAt)}同步` : '已配置'}`
                                                : '尚未配置自动同步分支'}
                                        </span>
                                    </div>
                                    <StatusPill tone={syncInfo.tone}>{syncInfo.label}</StatusPill>
                                </Link>
                            ) : null}
                        </div>
                    </section>
                </aside>
            </div>

            <ConfirmDialog
                open={stopTarget !== null}
                onOpenChange={(open) => {
                    if (!open && !stopMutation.isPending) setStopTarget(null);
                }}
                title="停止运行中的任务"
                description={
                    stopTarget
                        ? `确定停止「${stopTarget.flowId}」（分支 ${stopTarget.branch}）的当前执行吗？`
                        : undefined
                }
                confirmText="确认停止"
                variant="destructive"
                icon="warning"
                isLoading={stopMutation.isPending}
                onConfirm={async () => {
                    if (!stopTarget) return;
                    await stopMutation.mutateAsync(stopTarget.id);
                }}
            />
        </div>
    );
}
