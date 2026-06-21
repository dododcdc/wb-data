import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
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

function DetailLink({ row }: { row: OperationsExecutionListItem }) {
    return (
        <Link
            className="operations-link-button"
            to={`/operations/executions/${encodeURIComponent(row.id)}`}
            aria-label={`查看 ${row.flowId} 详情`}
        >
            <ExternalLink size={14} />
            查看详情
        </Link>
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
    const [branchInitializedGroupId, setBranchInitializedGroupId] = useState<number | null>(null);
    const [pendingRerunId, setPendingRerunId] = useState<string | null>(null);

    useEffect(() => {
        const now = new Date(Date.now());
        setBranchFilter('');
        setFlowFilter('');
        setStatusFilter(ALL_STATUSES);
        setFromFilter(formatLocalDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
        setToFilter(formatLocalDateTime(now));
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
        };
    }, [branchFilter, flowFilter, fromFilter, groupId, statusFilter, toFilter]);

    const executionsQuery = useQuery({
        queryKey: ['operations-executions', groupId, listQueryPayload],
        queryFn: () => listOperationsExecutions(listQueryPayload ?? undefined),
        enabled: listQueryPayload != null && branchInitializedGroupId === groupId,
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
    };

    if (groupId == null) {
        return (
            <div className="operations-center">
                <div className="operations-empty">请先选择项目组。</div>
            </div>
        );
    }

    return (
        <div className="operations-center">
            <div className="operations-center__shell">
                <header className="operations-center__header">
                    <h1 className="operations-center__title">运维中心</h1>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void queryClient.invalidateQueries({ queryKey: ['operations-executions'] })}
                        disabled={executionsQuery.isFetching}
                    >
                        <RefreshCw size={15} className={isRefreshing ? 'operations-spin' : ''} />
                        刷新
                    </Button>
                </header>

                <section className="operations-filter" aria-label="运行记录筛选">
                    <label className="operations-filter__field">
                        <span>分支</span>
                        <SimpleSelect
                            id="branch-select"
                            value={branchFilter || ALL_BRANCHES}
                            options={branchOptions}
                            disabled={repoStatusQuery.isLoading}
                            className="operations-filter__select"
                            onChange={(value) => setBranchFilter(value === ALL_BRANCHES ? '' : value)}
                        />
                    </label>

                    <label className="operations-filter__field operations-filter__field--search">
                        <span>任务</span>
                        <div className="operations-search">
                            <Search size={15} />
                            <input
                                aria-label="按任务名称筛选"
                                value={flowFilter}
                                onChange={(event) => setFlowFilter(event.target.value)}
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
                            onChange={setStatusFilter}
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
                            }}
                        />
                    </div>

                    <div className="operations-filter__actions">
                        <Button type="button" variant="outline" onClick={handleResetFilters}>
                            重置
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
                                    <th>触发时间</th>
                                    <th>开始时间</th>
                                    <th>结束时间</th>
                                    <th>耗时</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.id}>
                                        <td>
                                            <span className="operations-flow" title={row.flowId}>{row.flowId}</span>
                                        </td>
                                        <td>
                                            <span className="operations-branch" title={row.branch}>{row.branch}</span>
                                        </td>
                                        <td>
                                            <span className={statusClassName(row.status)}>{getExecutionStatusLabel(row.status)}</span>
                                        </td>
                                        <td className="operations-time">{formatBrowserDateTime(row.createdAt)}</td>
                                        <td className="operations-time">{formatBrowserDateTime(row.startDate)}</td>
                                        <td className="operations-time">{formatBrowserDateTime(row.endDate)}</td>
                                        <td className="operations-time">{formatDuration(row.durationMs)}</td>
                                        <td>
                                            <div className="operations-actions">
                                                <DetailLink row={row} />
                                                {row.rerunnable && canRerun ? (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        aria-label={`重跑 ${row.flowId}`}
                                                        disabled={pendingRerunId === row.id}
                                                        onClick={() => rerunMutation.mutate(row.id)}
                                                    >
                                                        <RotateCcw size={14} />
                                                        重跑
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                )}
            </div>
        </div>
    );
}
