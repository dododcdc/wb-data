import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    ExternalLink,
    RefreshCw,
    RotateCcw,
    Search,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { getOfflineRepoStatus } from '../../api/offline';
import {
    listOperationsExecutions,
    rerunOperationsExecution,
    type OperationsExecutionListItem,
    type OperationsExecutionListQuery,
} from '../../api/operations';
import { SimpleSelect } from '../../components/SimpleSelect';
import { Button } from '../../components/ui/button';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { formatBrowserDateTime, formatLocalDateTime, parseLocalDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import { getExecutionStatusLabel } from '../offline/executionPresentation';
import './OperationsCenter.css';
import { OperationsTimeFilter } from './OperationsTimeFilter';

const ALL_BRANCHES = '__all_branches__';
const ALL_STATUSES = '__all_statuses__';
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [50, 100, 200];
const PAGE_SIZE_STORAGE_KEY = 'wb-data.operations.pageSize';

const STATUS_OPTIONS = [
    { value: ALL_STATUSES, label: '全部状态' },
    { value: 'SUCCESS', label: '成功' },
    { value: 'FAILED', label: '失败' },
    { value: 'RUNNING', label: '执行中' },
    { value: 'RETRYING', label: '重试中' },
    { value: 'CREATED', label: '已创建' },
    { value: 'QUEUED', label: '排队中' },
    { value: 'CANCELLED', label: '已取消' },
    { value: 'KILLED', label: '已停止' },
];

function formatDuration(durationMs: number | null) {
    if (durationMs == null) return '—';
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${rest}s`;
}

function statusClassName(status: string) {
    if (status === 'SUCCESS') return 'operations-status operations-status--success';
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'KILLED') return 'operations-status operations-status--failed';
    if (status === 'RUNNING' || status === 'RETRYING') return 'operations-status operations-status--running';
    return 'operations-status operations-status--neutral';
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

function DetailLink({ row }: { row: OperationsExecutionListItem }) {
    return (
        <Link
            className="operations-icon-action"
            to={`/operations/executions/${encodeURIComponent(row.id)}`}
            aria-label={`查看 ${row.flowId} 详情`}
            title="查看详情"
        >
            <ExternalLink size={15} />
        </Link>
    );
}

function OperationsPagination({
    total,
    currentPage,
    pageSize,
    totalPages,
    isFetching,
    pageCount,
    onPageChange,
    onPageSizeChange,
}: {
    total: number;
    currentPage: number;
    pageSize: number;
    totalPages: number;
    isFetching: boolean;
    pageCount: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
}) {
    if (total === 0) return null;

    const effectiveTotalPages = Math.max(1, totalPages);
    const prevDisabled = currentPage <= 1 || isFetching;
    const nextDisabled = currentPage >= effectiveTotalPages || isFetching;
    const pageSizeOptions = PAGE_SIZE_OPTIONS.map((value) => ({
        label: `${value} 条`,
        value: String(value),
    }));

    const goToPage = (page: number) => {
        if (page < 1 || page > effectiveTotalPages || page === currentPage || isFetching) return;
        onPageChange(page);
    };

    return (
        <div className="operations-pagination">
            <div className="operations-page-info">本页 {pageCount} 条，共 {total} 条</div>

            <div className="operations-pagination-controls" aria-label="运行记录分页导航">
                <div className="operations-page-size-group">
                    <span className="operations-pagination-label">每页</span>
                    <div className="operations-page-size-select">
                        <SimpleSelect
                            id="operations-page-size"
                            value={String(pageSize)}
                            options={pageSizeOptions}
                            disabled={isFetching}
                            menuPlacement="up"
                            onChange={(value) => {
                                const parsed = Number(value);
                                if (Number.isFinite(parsed) && parsed !== pageSize) {
                                    onPageSizeChange(parsed);
                                }
                            }}
                        />
                    </div>
                </div>

                <div className="operations-page-status">
                    第 {currentPage} / {effectiveTotalPages} 页
                </div>

                <div className="operations-page-actions">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="第一页"
                        aria-disabled={prevDisabled}
                        disabled={prevDisabled}
                        onClick={() => goToPage(1)}
                    >
                        <ChevronsLeft size={16} />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="上一页"
                        aria-disabled={prevDisabled}
                        disabled={prevDisabled}
                        onClick={() => goToPage(currentPage - 1)}
                    >
                        <ChevronLeft size={16} />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="下一页"
                        aria-disabled={nextDisabled}
                        disabled={nextDisabled}
                        onClick={() => goToPage(currentPage + 1)}
                    >
                        <ChevronRight size={16} />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="最后一页"
                        aria-disabled={nextDisabled}
                        disabled={nextDisabled}
                        onClick={() => goToPage(effectiveTotalPages)}
                    >
                        <ChevronsRight size={16} />
                    </Button>
                </div>
            </div>
        </div>
    );
}

function LoadingRows() {
    return (
        <div className="operations-loading" role="status" aria-label="正在加载运行记录">
            <span className="sr-only">正在加载运行记录</span>
            {Array.from({ length: 5 }).map((_, index) => (
                <div className="operations-loading-row" key={index} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                </div>
            ))}
        </div>
    );
}

export default function OperationsCenter() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { showFeedback } = useOperationFeedback();
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const groupId = currentGroup?.id ?? null;
    const canRerun = systemAdmin || permissions.includes('offline.write');

    const [branchFilter, setBranchFilter] = useState('');
    const [flowFilter, setFlowFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
    const [fromFilter, setFromFilter] = useState(() => (
        formatLocalDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000))
    ));
    const [toFilter, setToFilter] = useState(() => formatLocalDateTime(new Date(Date.now())));
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(readStoredPageSize);
    const [branchInitializedGroupId, setBranchInitializedGroupId] = useState<number | null>(null);
    const [pendingRerunId, setPendingRerunId] = useState<string | null>(null);

    useEffect(() => {
        const now = new Date(Date.now());
        setBranchFilter('');
        setFlowFilter('');
        setStatusFilter(ALL_STATUSES);
        setFromFilter(formatLocalDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
        setToFilter(formatLocalDateTime(now));
        setCurrentPage(1);
        setBranchInitializedGroupId(null);
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
    });

    const branchOptions = useMemo(
        () => buildBranchOptions(executionsQuery.data?.branches ?? [], repoStatusQuery.data?.branch, branchFilter),
        [branchFilter, executionsQuery.data?.branches, repoStatusQuery.data?.branch],
    );

    const rerunMutation = useMutation({
        mutationFn: (executionId: string) => {
            if (groupId == null) throw new Error('missing group');
            return rerunOperationsExecution(groupId, executionId);
        },
        onMutate: (executionId) => {
            setPendingRerunId(executionId);
        },
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '已触发重跑', detail: '' });
            void queryClient.invalidateQueries({ queryKey: ['operations-executions'] });
        },
        onError: () => {
            showFeedback({ tone: 'error', title: '重跑触发失败', detail: '请稍后再试。' });
        },
        onSettled: () => {
            setPendingRerunId(null);
        },
    });

    const rows = executionsQuery.data?.executions ?? [];
    const total = executionsQuery.data?.total ?? rows.length;
    const totalPages = executionsQuery.data?.totalPages ?? Math.max(1, Math.ceil(total / pageSize) || 1);
    const displayPage = executionsQuery.data?.page ?? currentPage;
    const branchReady = groupId != null && branchInitializedGroupId === groupId;
    const isInitialLoading = repoStatusQuery.isLoading || !branchReady || executionsQuery.isLoading;
    const isRefreshing = executionsQuery.isFetching && rows.length > 0;

    const handleResetFilters = () => {
        const now = new Date(Date.now());
        setFlowFilter('');
        setStatusFilter(ALL_STATUSES);
        setFromFilter(formatLocalDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
        setToFilter(formatLocalDateTime(now));
        setBranchFilter(repoStatusQuery.data?.branch ?? '');
        setCurrentPage(1);
    };

    const handlePageSizeChange = (nextPageSize: number) => {
        setPageSize(nextPageSize);
        rememberPageSize(nextPageSize);
        setCurrentPage(1);
    };

    const openExecutionDetail = (executionId: string) => {
        navigate(`/operations/executions/${encodeURIComponent(executionId)}`);
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
                                placeholder="输入任务名称"
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
                            onChange={(from, to) => {
                                setFromFilter(from);
                                setToFilter(to);
                                setCurrentPage(1);
                            }}
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
                            onClick={() => void queryClient.invalidateQueries({ queryKey: ['operations-executions'] })}
                            disabled={executionsQuery.isFetching}
                        >
                            <RefreshCw size={15} className={isRefreshing ? 'operations-spin' : ''} />
                        </Button>
                    </div>
                </section>

                {isInitialLoading ? (
                    <LoadingRows />
                ) : executionsQuery.isError ? (
                    <div className="operations-error" role="alert">运行记录加载失败</div>
                ) : rows.length === 0 ? (
                    <div className="operations-empty">暂无运行记录。</div>
                ) : (
                    <>
                    <section className="operations-table" aria-label="运行记录">
                        <table>
                            <colgroup>
                                <col className="operations-col-task" />
                                <col className="operations-col-branch" />
                                <col className="operations-col-status" />
                                <col className="operations-col-time" />
                                <col className="operations-col-time" />
                                <col className="operations-col-time" />
                                <col className="operations-col-duration" />
                                <col className="operations-col-actions" />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>任务</th>
                                    <th>分支</th>
                                    <th>状态</th>
                                    <th>计划执行时间</th>
                                    <th>开始时间</th>
                                    <th>结束时间</th>
                                    <th>耗时</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr
                                        key={row.id}
                                        className="operations-row"
                                        tabIndex={0}
                                        aria-label={`查看 ${row.flowId} 执行详情`}
                                        onClick={() => openExecutionDetail(row.id)}
                                        onKeyDown={(event) => {
                                            if (event.key !== 'Enter' && event.key !== ' ') return;
                                            event.preventDefault();
                                            openExecutionDetail(row.id);
                                        }}
                                    >
                                        <td>
                                            <span className="operations-flow" title={row.flowId}>{row.flowId}</span>
                                        </td>
                                        <td>
                                            <span className="operations-branch" title={row.branch}>{row.branch}</span>
                                        </td>
                                        <td>
                                            <span className={statusClassName(row.status)}>{getExecutionStatusLabel(row.status)}</span>
                                        </td>
                                        <td className="operations-time">{formatBrowserDateTime(row.plannedAt)}</td>
                                        <td className="operations-time">{formatBrowserDateTime(row.startDate)}</td>
                                        <td className="operations-time">{formatBrowserDateTime(row.endDate)}</td>
                                        <td className="operations-time">{formatDuration(row.durationMs)}</td>
                                        <td>
                                            <div
                                                className="operations-actions"
                                                onClick={(event) => event.stopPropagation()}
                                                onKeyDown={(event) => event.stopPropagation()}
                                            >
                                                <DetailLink row={row} />
                                                {row.rerunnable && canRerun ? (
                                                    <button
                                                        type="button"
                                                        className="operations-icon-action"
                                                        aria-label={`重跑 ${row.flowId}`}
                                                        title={`重跑 ${row.flowId}`}
                                                        disabled={pendingRerunId === row.id}
                                                        onClick={() => rerunMutation.mutate(row.id)}
                                                    >
                                                        <RotateCcw size={14} />
                                                    </button>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                    <OperationsPagination
                        total={total}
                        currentPage={displayPage}
                        pageSize={pageSize}
                        totalPages={totalPages}
                        isFetching={executionsQuery.isFetching}
                        pageCount={rows.length}
                        onPageChange={setCurrentPage}
                        onPageSizeChange={handlePageSizeChange}
                    />
                    </>
                )}
            </div>
        </main>
    );
}
