import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    GitBranch,
    Lock,
    RefreshCw,
    RotateCcw,
    Search,
    X,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    getOperationsInstanceDiagnosis,
    rerunOperationsExecution,
    type OperationsExecutionLogEntry,
    type OperationsExecutionTaskRun,
    type OperationsInstanceDiagnosis,
    type OperationsInstanceUpstreamItem,
} from '../../api/operations';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { formatBrowserDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import {
    computeLogLevelCounts,
    getExecutionPresentation,
    getExecutionStatusLabel,
    getTaskStatusIcon,
    isRunningStatus,
    isUserTaskId,
} from '../../components/execution/executionPresentation';
import LogViewer, { type LogViewerItem } from '../../components/execution/LogViewer';
import {
    getInstanceStateLabel,
    getInstanceStateTone,
    isActiveInstanceState,
} from './instancePresentation';
import './OperationsExecutionDetailPage.css';
import './OperationsInstancePage.css';
import { OperationsRerunDialog } from './OperationsRerunDialog';

const LEVELS = ['ERROR', 'WARN', 'INFO'] as const;
const EMPTY_LOGS: OperationsExecutionLogEntry[] = [];

interface TrailEntry {
    group: number;
    branch: string;
    flowId: string;
    period: string;
}

function formatDuration(durationMs: number | null | undefined) {
    if (durationMs == null) return '—';
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const minuteRest = minutes % 60;
    return minuteRest > 0 ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function pickDefaultTaskId(taskRuns: OperationsExecutionTaskRun[]) {
    const failedTask = taskRuns.find((task) => getExecutionPresentation(task.status).dotTone === 'failed');
    return failedTask?.taskId ?? taskRuns[0]?.taskId ?? undefined;
}

function StatusPill({ state, label }: { state: string | null | undefined; label?: string }) {
    const tone = getInstanceStateTone(state);
    const Icon = getTaskStatusIcon(state);
    const spinning = isRunningStatus(state) || state === 'WAITING_UPSTREAM';
    return (
        <span className={`operations-execution-status operations-execution-status--${tone}`}>
            <Icon size={14} className={spinning ? 'operations-execution-spin' : undefined} />
            {label ?? getInstanceStateLabel(state)}
        </span>
    );
}

function DetailMetric({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="operations-execution-metric">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

export default function OperationsInstancePage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { executionId: routeExecutionId } = useParams<{ executionId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const { showSuccess, showError } = useOperationFeedback();
    const currentGroupId = currentGroup?.id ?? null;

    const groupParam = Number(searchParams.get('group'));
    const groupId = Number.isFinite(groupParam) && groupParam > 0 ? groupParam : currentGroupId;
    const branch = searchParams.get('branch');
    const flowId = searchParams.get('flowId');
    const period = searchParams.get('period');
    const executionParam = searchParams.get('execution');
    const hasInstanceAddress = Boolean(branch && flowId && period);
    const locatorExecutionId = routeExecutionId ?? (hasInstanceAddress ? null : executionParam);

    const [trail, setTrail] = useState<TrailEntry[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
    const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
    const [searchText, setSearchText] = useState('');
    const [rerunDialogOpen, setRerunDialogOpen] = useState(false);

    const locateQuery = useQuery({
        queryKey: ['operations-instance-locate', groupId, locatorExecutionId],
        enabled: groupId != null && locatorExecutionId != null,
        queryFn: () => getOperationsInstanceDiagnosis(groupId ?? 0, { executionId: locatorExecutionId }),
        retry: false,
    });

    useEffect(() => {
        const located = locateQuery.data;
        if (!located || locatorExecutionId == null || groupId == null) return;
        const next = new URLSearchParams();
        next.set('group', String(groupId));
        next.set('branch', located.branch);
        next.set('flowId', located.flowId);
        if (located.scheduleKey) next.set('period', located.scheduleKey);
        next.set('execution', locatorExecutionId);
        setSearchParams(next, { replace: true });
    }, [groupId, locateQuery.data, locatorExecutionId, setSearchParams]);

    const diagnosisQuery = useQuery({
        queryKey: ['operations-instance-diagnosis', groupId, branch, flowId, period],
        enabled: groupId != null && hasInstanceAddress,
        queryFn: () => getOperationsInstanceDiagnosis(groupId ?? 0, {
            branch, flowId, scheduleKey: period,
        }),
        refetchInterval: (query) => (isActiveInstanceState(query.state.data?.state) ? 10_000 : false),
    });

    const diagnosis: OperationsInstanceDiagnosis | null = diagnosisQuery.data
        ?? (locateQuery.data
            && locateQuery.data.branch === branch
            && locateQuery.data.flowId === flowId
            && locateQuery.data.scheduleKey === period
            ? locateQuery.data
            : null);

    const executions = useMemo(() => diagnosis?.executions ?? [], [diagnosis]);
    const selectedExecutionId = useMemo(() => {
        if (executions.length === 0) return executionParam;
        if (executionParam && executions.some((item) => item.id === executionParam)) return executionParam;
        return executions[0]?.id ?? null;
    }, [executions, executionParam]);

    const detailQuery = useQuery({
        queryKey: ['operations-execution', groupId, selectedExecutionId],
        enabled: groupId != null && Boolean(selectedExecutionId),
        queryFn: () => getOperationsExecution(groupId ?? 0, selectedExecutionId ?? ''),
    });
    const detail = detailQuery.data ?? null;

    const visibleTaskRuns = useMemo(
        () => detail?.taskRuns.filter((task) => isUserTaskId(task.taskId)) ?? [],
        [detail],
    );
    const defaultTaskId = useMemo(
        () => (detail ? pickDefaultTaskId(visibleTaskRuns) : undefined),
        [detail, visibleTaskRuns],
    );

    useEffect(() => {
        setSelectedTaskId(undefined);
        setActiveLevels(new Set());
        setSearchText('');
    }, [selectedExecutionId, groupId]);

    useEffect(() => {
        if (defaultTaskId === undefined || selectedTaskId !== undefined) return;
        setSelectedTaskId(defaultTaskId);
    }, [defaultTaskId, selectedTaskId]);

    const logsQuery = useQuery({
        queryKey: ['operations-execution-logs', groupId, selectedExecutionId, selectedTaskId],
        enabled: groupId != null && Boolean(detail) && selectedTaskId !== undefined,
        queryFn: () => getOperationsExecutionLogs(groupId ?? 0, selectedExecutionId ?? '', selectedTaskId ?? ''),
    });

    const rerunMutation = useMutation({
        mutationFn: (reuseManualOverrides: boolean) => rerunOperationsExecution(
            groupId ?? 0,
            selectedExecutionId ?? '',
            { reuseManualOverrides },
        ),
        onSuccess: () => {
            setRerunDialogOpen(false);
            showSuccess('已触发重跑');
            void queryClient.invalidateQueries({ queryKey: ['operations-instance-diagnosis'] });
            void queryClient.invalidateQueries({ queryKey: ['operations-execution', groupId, selectedExecutionId] });
        },
        onError: (error) => {
            showError(error, '重跑触发失败');
        },
    });

    const logs = logsQuery.data ?? EMPTY_LOGS;
    const levelCounts = useMemo(() => computeLogLevelCounts(logs), [logs]);
    const logItems = useMemo<LogViewerItem[]>(() => logs
        .filter((log) => {
            const level = log.level ?? 'INFO';
            return activeLevels.size === 0 || activeLevels.has(level);
        })
        .map((log, index) => ({
            timestamp: log.timestamp ?? '',
            level: log.level ?? 'INFO',
            taskId: log.taskId ?? 'flow',
            message: log.message ?? '',
            index,
        })), [activeLevels, logs]);

    const canRerun = Boolean(detail?.rerunnable && (systemAdmin || permissions.includes('offline.write')));
    const isRefreshing = diagnosisQuery.isRefetching || detailQuery.isRefetching || logsQuery.isRefetching;
    const refreshAll = () => {
        void diagnosisQuery.refetch();
        void detailQuery.refetch();
        void logsQuery.refetch();
    };

    const navigatePeriod = (scheduleKey: string | null) => {
        if (!scheduleKey) return;
        const next = new URLSearchParams(searchParams);
        next.set('period', scheduleKey);
        next.delete('execution');
        setSearchParams(next, { replace: true });
    };

    const drillToUpstream = (upstream: OperationsInstanceUpstreamItem) => {
        if (!upstream.accessible || groupId == null || !branch || !flowId || !period) return;
        setTrail((previous) => [...previous, { group: groupId, branch, flowId, period }]);
        setDrawerOpen(false);
        setSearchParams({
            group: String(upstream.groupId),
            branch,
            flowId: upstream.flowId,
            period: upstream.scheduleKey,
        });
    };

    const jumpToTrailEntry = (index: number) => {
        const target = trail[index];
        if (!target) return;
        setTrail((previous) => previous.slice(0, index));
        setSearchParams({
            group: String(target.group),
            branch: target.branch,
            flowId: target.flowId,
            period: target.period,
        });
    };

    useEffect(() => {
        if (!drawerOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setDrawerOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [drawerOpen]);

    const pageBusy = useDelayedBusy(
        (locatorExecutionId != null && locateQuery.isLoading) || (hasInstanceAddress && diagnosisQuery.isLoading),
    );

    if (groupId == null) {
        return (
            <div className="operations-execution-detail-page">
                <div className="operations-execution-empty">请先选择项目组。</div>
            </div>
        );
    }

    if (locatorExecutionId != null && locateQuery.isError) {
        return (
            <div className="operations-execution-detail-page">
                <div className="operations-execution-empty">执行记录不存在或不属于当前项目组。</div>
            </div>
        );
    }

    if (hasInstanceAddress && diagnosisQuery.isError) {
        return (
            <div className="operations-execution-detail-page">
                <div className="operations-execution-empty">调度实例加载失败。</div>
            </div>
        );
    }

    if (!diagnosis) {
        if (!pageBusy) {
            return <div className="operations-execution-detail-page" />;
        }
        return (
            <div className="operations-execution-detail-page" role="status">
                <span className="sr-only">正在加载调度实例</span>
                <div className="operations-execution-skeleton" aria-hidden="true">
                    <span className="skeleton-line operations-execution-skeleton-bar" />
                    <div className="operations-execution-skeleton-metrics">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <span key={index} className="skeleton-line operations-execution-skeleton-metric" />
                        ))}
                    </div>
                    <div className="operations-execution-skeleton-logs">
                        {Array.from({ length: 8 }).map((_, index) => (
                            <span key={index} className="skeleton-line operations-execution-skeleton-log" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="operations-execution-detail-page operations-instance-page">
            <header className="operations-execution-detail-header">
                <div className="operations-instance-header-left">
                    <button
                        type="button"
                        className="operations-execution-detail-back"
                        onClick={() => navigate('/operations')}
                        aria-label="返回运维中心"
                    >
                        <ArrowLeft size={17} />
                        <span>返回列表</span>
                    </button>
                    {trail.length > 0 && (
                        <nav className="operations-instance-trail" aria-label="钻取路径">
                            {trail.map((entry, index) => (
                                <span key={`${entry.group}-${entry.flowId}-${entry.period}`} className="operations-instance-trail-item">
                                    <button
                                        type="button"
                                        className="operations-instance-trail-link"
                                        onClick={() => jumpToTrailEntry(index)}
                                    >
                                        {entry.flowId}
                                    </button>
                                    <ChevronRight size={13} aria-hidden="true" />
                                </span>
                            ))}
                            <span className="operations-instance-trail-current">{diagnosis.flowId}</span>
                        </nav>
                    )}
                </div>

                <div className="operations-execution-detail-heading">
                    <div className="operations-execution-title-row">
                        <h1 title={diagnosis.flowId}>{diagnosis.flowId}</h1>
                        <StatusPill state={diagnosis.state} />
                    </div>
                    {diagnosis.reason && <p title={diagnosis.reason}>{diagnosis.reason}</p>}
                </div>

                <div className="operations-execution-detail-actions">
                    <button
                        type="button"
                        className="operations-execution-icon-button"
                        onClick={() => navigatePeriod(diagnosis.prevScheduleKey)}
                        disabled={!diagnosis.prevScheduleKey}
                        aria-label="上一期"
                        title="上一期"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        className="operations-execution-icon-button"
                        onClick={() => navigatePeriod(diagnosis.nextScheduleKey)}
                        disabled={!diagnosis.nextScheduleKey}
                        aria-label="下一期"
                        title="下一期"
                    >
                        <ChevronRight size={16} />
                    </button>
                    <button
                        type="button"
                        className="operations-instance-upstream-button"
                        onClick={() => setDrawerOpen(true)}
                        disabled={diagnosis.upstreams.length === 0}
                    >
                        <GitBranch size={15} />
                        上游实例{diagnosis.upstreams.length > 0 ? ` (${diagnosis.upstreams.length})` : ''}
                    </button>
                    <button
                        type="button"
                        className="operations-execution-icon-button"
                        onClick={refreshAll}
                        aria-label="刷新当前实例"
                        title="刷新当前实例"
                    >
                        <RefreshCw size={15} className={isRefreshing ? 'operations-execution-spin' : undefined} />
                    </button>
                    {canRerun && (
                        <button
                            type="button"
                            className="operations-execution-rerun"
                            onClick={() => setRerunDialogOpen(true)}
                            disabled={rerunMutation.isPending}
                        >
                            <RotateCcw size={15} className={rerunMutation.isPending ? 'operations-execution-spin' : undefined} />
                            重跑任务
                        </button>
                    )}
                </div>
            </header>

            <main className="operations-execution-detail-main">
                <section className="operations-execution-summary" aria-label="实例摘要">
                    <DetailMetric label="分支" value={<span title={diagnosis.branch}>{diagnosis.branch}</span>} />
                    <DetailMetric label="业务期" value={diagnosis.scheduleKey ?? '—'} />
                    <DetailMetric label="计划点火时间" value={formatBrowserDateTime(diagnosis.plannedFireAt)} />
                    <DetailMetric label="Cron" value={<span title={diagnosis.cron ?? ''}>{diagnosis.cron ?? '—'}</span>} />
                    <DetailMetric label="时区" value={diagnosis.timezone ?? '—'} />
                    <DetailMetric label="调度" value={diagnosis.scheduleEnabled ? '已启用' : '已停用'} />
                </section>

                {executions.length > 1 && (
                    <section className="operations-instance-executions" aria-label="本期执行">
                        <span className="operations-instance-executions-label">本期共 {executions.length} 次执行</span>
                        {executions.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`operations-instance-execution-chip${item.id === selectedExecutionId ? ' is-active' : ''}`}
                                onClick={() => {
                                    const next = new URLSearchParams(searchParams);
                                    next.set('execution', item.id);
                                    setSearchParams(next, { replace: true });
                                }}
                            >
                                <span className="operations-instance-execution-chip-time">
                                    {formatBrowserDateTime(item.createdAt)}
                                </span>
                                <StatusPill state={item.status} />
                                {item.rerun && <span className="operations-instance-rerun-badge">重跑</span>}
                            </button>
                        ))}
                    </section>
                )}

                {executions.length === 0 ? (
                    <section className="operations-instance-empty" aria-label="无执行实例">
                        <StatusPill state={diagnosis.state} />
                        <p>{diagnosis.reason ?? '本期尚未产生执行。'}</p>
                        {diagnosis.plannedFireAt && (
                            <p className="operations-instance-empty-fire">
                                计划点火时间：{formatBrowserDateTime(diagnosis.plannedFireAt)}
                            </p>
                        )}
                    </section>
                ) : detailQuery.isLoading || !detail ? (
                    <div className="operations-execution-log-loading" role="status">
                        {Array.from({ length: 8 }).map((_, index) => (
                            <span key={index} />
                        ))}
                    </div>
                ) : detailQuery.isError ? (
                    <div className="operations-execution-empty-inline" role="alert">执行详情加载失败。</div>
                ) : (
                    <>
                        {executions.length === 1 && executions[0]?.rerun && (
                            <section className="operations-instance-executions" aria-label="本期执行">
                                <span className="operations-instance-executions-label">本次执行为重跑</span>
                                <span className="operations-instance-rerun-badge">重跑</span>
                            </section>
                        )}
                        <section className="operations-execution-summary" aria-label="执行摘要">
                            <DetailMetric label="状态" value={<StatusPill state={detail.status} />} />
                            <DetailMetric label="计划执行时间" value={formatBrowserDateTime(detail.plannedAt)} />
                            <DetailMetric label="开始时间" value={formatBrowserDateTime(detail.startDate)} />
                            <DetailMetric label="结束时间" value={formatBrowserDateTime(detail.endDate)} />
                            <DetailMetric label="耗时" value={formatDuration(detail.durationMs)} />
                            <DetailMetric label="节点数" value={visibleTaskRuns.length} />
                        </section>

                        <section className="operations-execution-workspace">
                            <aside className="operations-execution-tasks" aria-label="节点列表">
                                <div className="operations-execution-task-list">
                                    {visibleTaskRuns.length === 0 ? (
                                        <div className="operations-execution-empty-inline">暂无节点。</div>
                                    ) : visibleTaskRuns.map((task) => {
                                        const tone = getExecutionPresentation(task.status).dotTone;
                                        const Icon = getTaskStatusIcon(task.status);
                                        return (
                                            <button
                                                key={task.taskId}
                                                type="button"
                                                className={`operations-execution-task${selectedTaskId === task.taskId ? ' is-active' : ''}`}
                                                onClick={() => setSelectedTaskId(task.taskId)}
                                                aria-label={`查看 ${task.taskId} 日志`}
                                            >
                                                <span className="operations-execution-task__main">
                                                    <span className="operations-execution-task__name" title={task.taskId}>{task.taskId}</span>
                                                    <span className={`operations-execution-status operations-execution-status--${tone}`}>
                                                        <Icon size={14} className={isRunningStatus(task.status) ? 'operations-execution-spin' : undefined} />
                                                        {getExecutionStatusLabel(task.status)}
                                                    </span>
                                                </span>
                                                <span className="operations-execution-task__meta">
                                                    <span>{formatBrowserDateTime(task.startDate)}</span>
                                                    <span>{formatDuration(task.durationMs)}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </aside>

                            <section className="operations-execution-logs" aria-label="执行日志">
                                <div className="operations-execution-log-tools">
                                    <div className="operations-execution-levels" aria-label="日志级别">
                                        {LEVELS.map((level) => {
                                            const active = activeLevels.has(level);
                                            const dimmed = activeLevels.size > 0 && !active;
                                            return (
                                                <button
                                                    key={level}
                                                    type="button"
                                                    className={`operations-execution-level operations-execution-level--${level.toLowerCase()}${dimmed ? ' is-dimmed' : ''}${active ? ' is-active' : ''}`}
                                                    onClick={() => {
                                                        setActiveLevels((previous) => {
                                                            const next = new Set(previous);
                                                            if (next.has(level)) {
                                                                next.delete(level);
                                                            } else {
                                                                next.add(level);
                                                            }
                                                            return next.size === LEVELS.length ? new Set() : next;
                                                        });
                                                    }}
                                                >
                                                    {level} {levelCounts[level] ?? 0}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div className="operations-execution-log-actions">
                                        <label className="operations-execution-log-search">
                                            <Search size={14} />
                                            <input
                                                type="search"
                                                value={searchText}
                                                onChange={(event) => setSearchText(event.target.value)}
                                                placeholder="搜索日志"
                                            />
                                        </label>
                                    </div>
                                </div>

                                {logsQuery.isLoading || selectedTaskId === undefined ? (
                                    <div className="operations-execution-log-loading" role="status">
                                        {Array.from({ length: 8 }).map((_, index) => (
                                            <span key={index} />
                                        ))}
                                    </div>
                                ) : logsQuery.isError ? (
                                    <div className="operations-execution-log-error" role="alert">
                                        <span>日志加载失败。</span>
                                        <button type="button" onClick={() => void logsQuery.refetch()}>重试</button>
                                    </div>
                                ) : (
                                    <LogViewer
                                        items={logItems}
                                        searchQuery={searchText}
                                        currentMatchPosition={-1}
                                    />
                                )}
                            </section>
                        </section>
                    </>
                )}
            </main>

            {drawerOpen && (
                <div
                    className="operations-instance-drawer-overlay"
                    onClick={() => setDrawerOpen(false)}
                    role="presentation"
                >
                    <aside
                        className="operations-instance-drawer"
                        role="dialog"
                        aria-label="上游实例"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className="operations-instance-drawer-header">
                            <h2>上游实例 · {diagnosis.scheduleKey}</h2>
                            <button
                                type="button"
                                className="operations-execution-icon-button"
                                onClick={() => setDrawerOpen(false)}
                                aria-label="关闭上游实例"
                            >
                                <X size={15} />
                            </button>
                        </header>
                        <div className="operations-instance-drawer-body">
                            {diagnosis.upstreams.length === 0 ? (
                                <div className="operations-execution-empty-inline">本任务没有配置上游依赖。</div>
                            ) : diagnosis.upstreams.map((upstream) => {
                                const displayName = upstream.groupName
                                    ? `${upstream.groupName} / ${upstream.flowId}`
                                    : upstream.flowId;
                                return (
                                    <button
                                        key={`${upstream.groupId}-${upstream.flowId}`}
                                        type="button"
                                        className="operations-instance-upstream-row"
                                        disabled={!upstream.accessible}
                                        title={upstream.accessible ? `查看 ${displayName} 实例详情` : '无该项目组权限'}
                                        onClick={() => drillToUpstream(upstream)}
                                    >
                                        <span className="operations-instance-upstream-main">
                                            <span className="operations-instance-upstream-name" title={displayName}>
                                                {!upstream.accessible && <Lock size={13} aria-label="无权限" />}
                                                {displayName}
                                            </span>
                                            <span className="operations-instance-upstream-meta">
                                                {upstream.satisfied ? '已满足闸门' : '未满足闸门'}
                                            </span>
                                        </span>
                                        <StatusPill state={upstream.state} />
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                </div>
            )}

            <OperationsRerunDialog
                open={rerunDialogOpen}
                groupId={groupId}
                executionId={selectedExecutionId}
                detail={detail}
                pending={rerunMutation.isPending}
                onOpenChange={setRerunDialogOpen}
                onConfirm={(reuseManualOverrides) => rerunMutation.mutate(reuseManualOverrides)}
            />
        </div>
    );
}
