import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getOfflineRepoStatus } from '../../api/offline';
import {
    listOperationsExecutions,
    rerunOperationsExecution,
    type OperationsExecutionListItem,
    type OperationsExecutionListQuery,
} from '../../api/operations';
import { SimpleSelect } from '../../components/SimpleSelect';
import { Button } from '../../components/ui/button';
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
    const { showSuccess, showError } = useOperationFeedback();
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
    const [rerunTarget, setRerunTarget] = useState<OperationsExecutionListItem | null>(null);

    useEffect(() => {
        const now = new Date(Date.now());
        setBranchFilter('');
        setFlowFilter('');
        setStatusFilter(ALL_STATUSES);
        setFromFilter(formatLocalDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
        setToFilter(formatLocalDateTime(now));
        setCurrentPage(1);
        setBranchInitializedGroupId(null);
        setRerunTarget(null);
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
        mutationFn: ({ executionId, reuseManualOverrides }: {
            executionId: string;
            reuseManualOverrides: boolean;
        }) => {
            if (groupId == null) throw new Error('missing group');
            return rerunOperationsExecution(groupId, executionId, { reuseManualOverrides });
        },
        onMutate: ({ executionId }) => {
            setPendingRerunId(executionId);
        },
        onSuccess: () => {
            setRerunTarget(null);
            showSuccess('已触发重跑');
            void queryClient.invalidateQueries({ queryKey: ['operations-executions'] });
        },
        onError: (error) => {
            showError(error, '重跑触发失败');
        },
        onSettled: () => {
            setPendingRerunId(null);
        },
    });

    const rows = executionsQuery.data?.executions ?? [];
    const total = executionsQuery.data?.total ?? rows.length;
    const displayPage = executionsQuery.data?.page ?? currentPage;
    const branchReady = groupId != null && branchInitializedGroupId === groupId;
    const isInitialLoading = repoStatusQuery.isLoading || !branchReady || executionsQuery.isLoading;
    const isRefreshing = useDelayedBusy(executionsQuery.isFetching && rows.length > 0, { delayMs: 140, minVisibleMs: 320 });

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

                <OperationsTable
                    rows={rows}
                    canRerun={canRerun}
                    errorMessage={executionsQuery.error instanceof Error ? executionsQuery.error.message : ''}
                    hasFooter={total > 0}
                    isLoading={isInitialLoading}
                    isRefreshing={isRefreshing}
                    pendingRerunId={pendingRerunId}
                    onOpenDetail={openExecutionDetail}
                    onRerun={setRerunTarget}
                    onResetFilters={handleResetFilters}
                    onRetry={() => void executionsQuery.refetch()}
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
                onConfirm={(reuseManualOverrides) => {
                    if (!rerunTarget) return;
                    rerunMutation.mutate({ executionId: rerunTarget.id, reuseManualOverrides });
                }}
            />
        </main>
    );
}
