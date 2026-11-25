import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getOfflineRepoStatus } from '../../api/offline';
import {
    listOperationsExecutions,
    markOperationsExecutionSuccess,
    rerunOperationsExecution,
    stopOperationsExecution,
    type OperationsExecutionListItem,
    type OperationsExecutionListQuery,
    type OperationsExecutionRerunRequest,
    type OperationsExecutionStatusCounts,
} from '../../api/operations';
import { SimpleSelect } from '../../components/SimpleSelect';
import { isActiveStatus } from '../../components/execution/executionPresentation';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ListPagination } from '../../components/ui/list/ListPagination';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { formatLocalDateTime, parseLocalDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import './OperationsCenter.css';
import { OperationsRerunDialog } from './OperationsRerunDialog';
import { OperationsTable } from './OperationsTable';
import { OperationsTimeFilter } from './OperationsTimeFilter';

const ALL_BRANCHES = '__all_branches__';
const ALL_STATUSES = '__all_statuses__';
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [50, 100, 200];
const PAGE_SIZE_STORAGE_KEY = 'wb-data.operations.pageSize';
const DEFAULT_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

const STATUS_OPTIONS = [
    { value: ALL_STATUSES, label: '全部状态' },
    { value: 'ACTIVE', label: '进行中' },
    { value: 'SUCCESS', label: '成功' },
    { value: 'FORCE_SUCCESS', label: '人工置成功' },
    { value: 'FAILED', label: '失败' },
    { value: 'RUNNING', label: '执行中' },
    { value: 'RETRYING', label: '重试中' },
    { value: 'RETRIED', label: '已重试' },
    { value: 'CREATED', label: '已创建' },
    { value: 'QUEUED', label: '排队中' },
    { value: 'CANCELLED', label: '已取消' },
    { value: 'KILLED', label: '已停止' },
];

const VALID_STATUS_FILTER_VALUES = new Set(STATUS_OPTIONS.map((option) => option.value));

function resolveInitialStatusFilter(rawStatus: string | null) {
    const normalized = rawStatus?.trim().toUpperCase();
    return normalized && VALID_STATUS_FILTER_VALUES.has(normalized) ? normalized : ALL_STATUSES;
}

function resolveInitialBranchFilter(rawBranch: string | null) {
    const trimmed = rawBranch?.trim();
    if (!trimmed) {
        return { initialized: false, value: '' };
    }
    if (trimmed === '__all__' || trimmed === ALL_BRANCHES) {
        return { initialized: true, value: '' };
    }
    return { initialized: true, value: trimmed };
}

function normalizeDateTimeInput(value: string) {
    return parseLocalDateTime(value)?.toISOString() ?? null;
}

function buildBranchOptions(branches: string[], currentBranch: string | null | undefined, selectedBranch: string) {
    const names = new Set<string>();
    if (currentBranch) names.add(currentBranch);
    if (selectedBranch) names.add(selectedBranch);
    for (const branch of branches) names.add(branch);

    return [
        { value: ALL_BRANCHES, label: '全部分支' },
        ...Array.from(names).map((branch) => ({ value: branch, label: branch })),
    ];
}

function readStoredPageSize() {
    try {
        const stored = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
        const parsed = Number(stored);
        return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
    } catch {
        return DEFAULT_PAGE_SIZE;
    }
}

function rememberPageSize(pageSize: number) {
    try {
        window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
    } catch {
        // Ignore storage failures; pagination should still work for this session.
    }
}

export default function OperationsCenter() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { showSuccess, showError } = useOperationFeedback();
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const groupId = currentGroup?.id ?? null;
    const canOperate = systemAdmin || permissions.includes('offline.write');

    const [branchFilter, setBranchFilter] = useState(
        () => resolveInitialBranchFilter(searchParams.get('branch')).value,
    );
    const [flowFilter, setFlowFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState(() => resolveInitialStatusFilter(searchParams.get('status')));
    const [rollingWindowMs, setRollingWindowMs] = useState<number | null>(DEFAULT_ROLLING_WINDOW_MS);
    const [fromFilter, setFromFilter] = useState(() => (
        formatLocalDateTime(new Date(Date.now() - DEFAULT_ROLLING_WINDOW_MS))
    ));
    const [toFilter, setToFilter] = useState(() => formatLocalDateTime(new Date(Date.now())));
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(readStoredPageSize);
    const [branchInitializedGroupId, setBranchInitializedGroupId] = useState<number | null>(() => (
        resolveInitialBranchFilter(searchParams.get('branch')).initialized ? groupId : null
    ));
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [pendingRerunId, setPendingRerunId] = useState<string | null>(null);
    const [rerunTarget, setRerunTarget] = useState<OperationsExecutionListItem | null>(null);
    const [pendingStopId, setPendingStopId] = useState<string | null>(null);
    const [stopTarget, setStopTarget] = useState<OperationsExecutionListItem | null>(null);
    const [pendingMarkSuccessId, setPendingMarkSuccessId] = useState<string | null>(null);
    const [markSuccessTarget, setMarkSuccessTarget] = useState<OperationsExecutionListItem | null>(null);
    const prevGroupIdRef = useRef<number | null>(groupId);

    useEffect(() => {
        const groupChanged = prevGroupIdRef.current !== groupId;
        prevGroupIdRef.current = groupId;
        if (!groupChanged) return;
        const now = Date.now();
        setBranchFilter('');
        setFlowFilter('');
        setStatusFilter(ALL_STATUSES);
        setRollingWindowMs(DEFAULT_ROLLING_WINDOW_MS);
        setFromFilter(formatLocalDateTime(new Date(now - DEFAULT_ROLLING_WINDOW_MS)));
        setToFilter(formatLocalDateTime(new Date(now)));
        setCurrentPage(1);
        setBranchInitializedGroupId(null);
        setRerunTarget(null);
        setStopTarget(null);
        setMarkSuccessTarget(null);
    }, [groupId]);

    const repoStatusQuery = useQuery({
        queryKey: ['operations-current-branch', groupId],
        queryFn: () => getOfflineRepoStatus(groupId as number),
        enabled: groupId != null,
    });

    useEffect(() => {
        if (groupId == null || branchInitializedGroupId === groupId || repoStatusQuery.isLoading) return;
        setBranchFilter(repoStatusQuery.data?.branch ?? '');
        setBranchInitializedGroupId(groupId);
    }, [branchInitializedGroupId, groupId, repoStatusQuery.data?.branch, repoStatusQuery.isLoading]);

    const listQueryPayload = useMemo<OperationsExecutionListQuery | null>(() => {
        if (groupId == null) return null;

        return {
            groupId,
            branch: branchFilter || null,
            flowId: flowFilter.trim() || null,
            status: statusFilter === ALL_STATUSES ? null : statusFilter,
            from: normalizeDateTimeInput(fromFilter),
            to: normalizeDateTimeInput(toFilter),
            page: currentPage,
            pageSize,
        };
    }, [branchFilter, currentPage, flowFilter, fromFilter, groupId, pageSize, statusFilter, toFilter]);

    const executionsQuery = useQuery({
        queryKey: ['operations-executions', groupId, listQueryPayload],
        queryFn: () => listOperationsExecutions(listQueryPayload!),
        enabled: listQueryPayload != null && branchInitializedGroupId === groupId,
        placeholderData: (previousData) => previousData,
        refetchInterval: (query) => {
            if (!autoRefresh || rollingWindowMs != null) return false;
            const data = query.state.data;
            if (!data) return false;
            const hasActive = (data.statusCounts?.active ?? 0) > 0
                || data.executions.some((row) => isActiveStatus(row.status));
            return hasActive ? 5_000 : false;
        },
    });

    const refreshExecutions = useCallback(() => {
        if (rollingWindowMs != null) {
            const now = Date.now();
            const nextFrom = formatLocalDateTime(new Date(now - rollingWindowMs));
            const nextTo = formatLocalDateTime(new Date(now));
            if (nextFrom !== fromFilter || nextTo !== toFilter) {
                setFromFilter(nextFrom);
                setToFilter(nextTo);
                return;
            }
        }
        void queryClient.invalidateQueries({ queryKey: ['operations-executions'] });
    }, [fromFilter, queryClient, rollingWindowMs, toFilter]);

    const branchOptions = useMemo(
        () => buildBranchOptions(executionsQuery.data?.branches ?? [], repoStatusQuery.data?.branch, branchFilter),
        [branchFilter, executionsQuery.data?.branches, repoStatusQuery.data?.branch],
    );

    const rerunMutation = useMutation({
        mutationFn: ({ executionId, payload }: {
            executionId: string;
            payload: OperationsExecutionRerunRequest;
        }) => {
            if (groupId == null) throw new Error('missing group');
            return rerunOperationsExecution(groupId, executionId, payload);
        },
        onMutate: ({ executionId }) => {
            setPendingRerunId(executionId);
        },
        onSuccess: () => {
            setRerunTarget(null);
            showSuccess('已触发重跑');
            refreshExecutions();
        },
        onError: (error) => {
            showError(error, '重跑触发失败');
        },
        onSettled: () => {
            setPendingRerunId(null);
        },
    });

    const stopMutation = useMutation({
        mutationFn: (executionId: string) => {
            if (groupId == null) throw new Error('missing group');
            return stopOperationsExecution(groupId, executionId);
        },
        onMutate: (executionId) => {
            setPendingStopId(executionId);
        },
        onSuccess: () => {
            setStopTarget(null);
            showSuccess('已发送停止请求');
            refreshExecutions();
        },
        onError: (error) => {
            showError(error, '停止任务失败');
        },
        onSettled: () => {
            setPendingStopId(null);
        },
    });

    const markSuccessMutation = useMutation({
        mutationFn: (executionId: string) => {
            if (groupId == null) throw new Error('missing group');
            return markOperationsExecutionSuccess(groupId, executionId);
        },
        onMutate: (executionId) => {
            setPendingMarkSuccessId(executionId);
        },
        onSuccess: () => {
            setMarkSuccessTarget(null);
            showSuccess('已置为成功');
            refreshExecutions();
            void queryClient.invalidateQueries({ queryKey: ['operations-instance-diagnosis'] });
            void queryClient.invalidateQueries({ queryKey: ['operations-execution'] });
        },
        onError: (error) => {
            showError(error, '置成功失败');
        },
        onSettled: () => {
            setPendingMarkSuccessId(null);
        },
    });

    const rows = useMemo(() => executionsQuery.data?.executions ?? [], [executionsQuery.data?.executions]);
    const total = executionsQuery.data?.total ?? rows.length;
    const displayPage = executionsQuery.data?.page ?? currentPage;
    const branchReady = groupId != null && branchInitializedGroupId === groupId;
    const isInitialLoading = repoStatusQuery.isLoading || !branchReady || executionsQuery.isLoading;
    const isRefreshing = useDelayedBusy(executionsQuery.isFetching && rows.length > 0, { delayMs: 140, minVisibleMs: 320 });

    const statusCounts = useMemo<OperationsExecutionStatusCounts>(() => {
        if (executionsQuery.data?.statusCounts) return executionsQuery.data.statusCounts;
        return {
            total,
            success: rows.filter((row) => row.status === 'SUCCESS' || row.status === 'FORCE_SUCCESS').length,
            failed: rows.filter((row) => row.status === 'FAILED').length,
            active: rows.filter((row) => isActiveStatus(row.status)).length,
            stopped: rows.filter((row) => row.status === 'KILLED' || row.status === 'CANCELLED').length,
        };
    }, [executionsQuery.data?.statusCounts, rows, total]);
    const hasActiveExecutions = statusCounts.active > 0 || rows.some((row) => isActiveStatus(row.status));

    useEffect(() => {
        if (!autoRefresh || !hasActiveExecutions || !branchReady || rollingWindowMs == null) return undefined;
        const timer = window.setInterval(() => {
            refreshExecutions();
        }, 5_000);
        return () => window.clearInterval(timer);
    }, [autoRefresh, branchReady, hasActiveExecutions, refreshExecutions, rollingWindowMs]);

    const handleResetFilters = () => {
        const now = Date.now();
        setFlowFilter('');
        setStatusFilter(ALL_STATUSES);
        setRollingWindowMs(DEFAULT_ROLLING_WINDOW_MS);
        setFromFilter(formatLocalDateTime(new Date(now - DEFAULT_ROLLING_WINDOW_MS)));
        setToFilter(formatLocalDateTime(new Date(now)));
        setBranchFilter(repoStatusQuery.data?.branch ?? '');
        setCurrentPage(1);
    };

    const handleSummaryFilter = (nextStatus: string) => {
        setStatusFilter((current) => (
            nextStatus === ALL_STATUSES
                ? ALL_STATUSES
                : current === nextStatus ? ALL_STATUSES : nextStatus
        ));
        setCurrentPage(1);
    };

    const handlePageSizeChange = (nextPageSize: number) => {
        setPageSize(nextPageSize);
        rememberPageSize(nextPageSize);
        setCurrentPage(1);
    };

    const openExecutionDetail = (executionId: string) => {
        navigate(`/operations/instances?execution=${encodeURIComponent(executionId)}`);
    };

    if (groupId == null) {
        return (
            <div className="operations-center">
                <div className="operations-empty">请先选择项目组。</div>
            </div>
        );
    }

    return (
        <main className="operations-center" aria-label="运维中心">
            <div className="operations-center__shell">
                <section className="operations-filter" aria-label="运行记录筛选">
                    <label className="operations-filter__field">
                        <span>分支</span>
                        <SimpleSelect
                            id="branch-select"
                            value={branchFilter || ALL_BRANCHES}
                            options={branchOptions}
                            disabled={repoStatusQuery.isLoading}
                            className="operations-filter__select"
                            onChange={(value) => {
                                setBranchFilter(value === ALL_BRANCHES ? '' : value);
                                setCurrentPage(1);
                            }}
                        />
                    </label>

                    <label className="operations-filter__field operations-filter__field--search">
                        <span>任务</span>
                        <div className="operations-search">
                            <Search size={15} />
                            <input
                                aria-label="按任务名称筛选"
                                value={flowFilter}
                                onChange={(event) => {
                                    setFlowFilter(event.target.value);
                                    setCurrentPage(1);
                                }}
                            />
                        </div>
                    </label>

                    <label className="operations-filter__field">
                        <span>状态</span>
                        <SimpleSelect
                            id="status-select"
                            value={statusFilter}
                            options={STATUS_OPTIONS}
                            className="operations-filter__select"
                            onChange={(value) => {
                                setStatusFilter(value);
                                setCurrentPage(1);
                            }}
                        />
                    </label>

                    <div className="operations-filter__field operations-filter__field--time-range">
                        <span>时间范围</span>
                        <OperationsTimeFilter
                            from={fromFilter}
                            to={toFilter}
                            rollingWindowMs={rollingWindowMs}
                            onChange={(from, to) => {
                                setFromFilter(from);
                                setToFilter(to);
                                setRollingWindowMs(null);
                                setCurrentPage(1);
                            }}
                            onRollingWindowChange={setRollingWindowMs}
                        />
                    </div>

                    <div className="operations-filter__actions">
                        <Button type="button" variant="outline" onClick={handleResetFilters}>
                            重置
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="刷新运行记录"
                            title="刷新运行记录"
                            onClick={refreshExecutions}
                            disabled={executionsQuery.isFetching}
                        >
                            <RefreshCw size={15} className={isRefreshing ? 'operations-spin' : ''} />
                        </Button>
                    </div>
                </section>

                <section className="operations-summary-bar" aria-label="状态速览与自动刷新">
                    <div className="operations-summary-pills" role="group" aria-label="状态速览">
                        <button
                            type="button"
                            className={`operations-summary-pill${statusFilter === ALL_STATUSES ? ' is-active' : ''}`}
                            aria-pressed={statusFilter === ALL_STATUSES}
                            onClick={() => handleSummaryFilter(ALL_STATUSES)}
                        >
                            <span>全部</span>
                            <span className="operations-summary-pill__count">
                                {isInitialLoading ? '—' : statusCounts.total}
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`operations-summary-pill operations-summary-pill--failed${statusCounts.failed > 0 ? ' has-count' : ''}${statusFilter === 'FAILED' ? ' is-active' : ''}`}
                            aria-pressed={statusFilter === 'FAILED'}
                            onClick={() => handleSummaryFilter('FAILED')}
                        >
                            <span>失败</span>
                            <span className="operations-summary-pill__count">
                                {isInitialLoading ? '—' : statusCounts.failed}
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`operations-summary-pill operations-summary-pill--active${statusCounts.active > 0 ? ' has-count' : ''}${statusFilter === 'ACTIVE' ? ' is-active' : ''}`}
                            aria-pressed={statusFilter === 'ACTIVE'}
                            onClick={() => handleSummaryFilter('ACTIVE')}
                        >
                            {statusCounts.active > 0 ? (
                                <span className="operations-summary-pill__dot is-live" aria-hidden="true" />
                            ) : null}
                            <span>进行中</span>
                            <span className="operations-summary-pill__count">
                                {isInitialLoading ? '—' : statusCounts.active}
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`operations-summary-pill operations-summary-pill--success${statusCounts.success > 0 ? ' has-count' : ''}${statusFilter === 'SUCCESS' ? ' is-active' : ''}`}
                            aria-pressed={statusFilter === 'SUCCESS'}
                            onClick={() => handleSummaryFilter('SUCCESS')}
                        >
                            <span>成功</span>
                            <span className="operations-summary-pill__count">
                                {isInitialLoading ? '—' : statusCounts.success}
                            </span>
                        </button>
                    </div>

                    <button
                        type="button"
                        className={`operations-auto-refresh${autoRefresh && hasActiveExecutions ? ' is-polling' : !autoRefresh ? ' is-off' : ''}`}
                        aria-pressed={autoRefresh}
                        title="存在进行中任务时每 5 秒自动刷新"
                        onClick={() => setAutoRefresh((current) => !current)}
                    >
                        <span className="operations-auto-refresh__dot" aria-hidden="true" />
                        <span>
                            {!autoRefresh
                                ? '自动刷新已关闭'
                                : hasActiveExecutions
                                    ? '自动刷新 5s'
                                    : '自动刷新'}
                        </span>
                    </button>
                </section>

                <OperationsTable
                    rows={rows}
                    canRerun={canOperate}
                    canStop={canOperate}
                    canMarkSuccess={canOperate}
                    errorMessage={executionsQuery.error instanceof Error ? executionsQuery.error.message : ''}
                    hasFooter={total > 0}
                    isLoading={isInitialLoading}
                    isRefreshing={isRefreshing}
                    pendingRerunId={pendingRerunId}
                    pendingStopId={pendingStopId}
                    pendingMarkSuccessId={pendingMarkSuccessId}
                    onOpenDetail={openExecutionDetail}
                    onRerun={setRerunTarget}
                    onStop={setStopTarget}
                    onMarkSuccess={setMarkSuccessTarget}
                    onResetFilters={handleResetFilters}
                    onRetry={refreshExecutions}
                />
                <ListPagination
                    total={total}
                    currentPage={displayPage}
                    pageSize={pageSize}
                    isFetching={executionsQuery.isFetching}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={handlePageSizeChange}
                    pageSizeOptions={PAGE_SIZE_OPTIONS}
                    selectId="operations-page-size"
                    ariaLabel="运行记录分页导航"
                />
            </div>
            <OperationsRerunDialog
                open={rerunTarget != null}
                groupId={groupId}
                executionId={rerunTarget?.id ?? null}
                pending={rerunMutation.isPending}
                onOpenChange={(open) => {
                    if (!open) setRerunTarget(null);
                }}
                onConfirm={(payload) => {
                    if (!rerunTarget) return;
                    rerunMutation.mutate({ executionId: rerunTarget.id, payload });
                }}
            />
            <ConfirmDialog
                open={stopTarget != null}
                onOpenChange={(open) => {
                    if (!open && !stopMutation.isPending) setStopTarget(null);
                }}
                title="确认停止任务"
                description={stopTarget
                    ? `将向 Kestra 发送停止指令，中断任务「${stopTarget.flowId}」的当前执行。已执行完成的节点不会自动回滚。`
                    : undefined}
                confirmText="确认停止"
                variant="destructive"
                icon="warning"
                isLoading={stopMutation.isPending}
                onConfirm={() => {
                    if (stopTarget) stopMutation.mutate(stopTarget.id);
                }}
            />
            <ConfirmDialog
                open={markSuccessTarget != null}
                onOpenChange={(open) => {
                    if (!open && !markSuccessMutation.isPending) setMarkSuccessTarget(null);
                }}
                title="确认置成功"
                description={markSuccessTarget
                    ? `将任务「${markSuccessTarget.flowId}」的本次执行状态置为「人工置成功」。下游等待任务将自动放行，原始失败节点与报错日志会完整保留；置成功后本次执行不可再重跑。`
                    : undefined}
                confirmText="确认置成功"
                variant="success"
                icon="success"
                isLoading={markSuccessMutation.isPending}
                onConfirm={() => {
                    if (markSuccessTarget) markSuccessMutation.mutate(markSuccessTarget.id);
                }}
            />
        </main>
    );
}
