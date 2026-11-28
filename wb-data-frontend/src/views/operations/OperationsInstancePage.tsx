import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    CheckCheck,
    ChevronRight,
    Code2,
    ExternalLink,
    GitBranch,
    Info,
    LayoutList,
    Lock,
    Network,
    RefreshCw,
    RotateCcw,
    Search,
    SlidersHorizontal,
    Square,
    Terminal,
    TriangleAlert,
    X,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    getOperationsInstanceDiagnosis,
    markOperationsExecutionSuccess,
    rerunOperationsExecution,
    stopOperationsExecution,
    type OperationsExecutionGraphNode,
    type OperationsExecutionLogEntry,
    type OperationsExecutionRerunRequest,
    type OperationsExecutionTaskRun,
    type OperationsInstanceDiagnosis,
    type OperationsInstanceUpstreamItem,
    type OperationsRerunGraphEdge,
} from '../../api/operations';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { formatBrowserDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import {
    computeLogLevelCounts,
    getExecutionPresentation,
    getExecutionStatusLabel,
    getRerunBadgeMeta,
    getTaskStatusIcon,
    isActiveStatus,
    isMarkableSuccess,
    isRunningStatus,
    isStoppable,
    isUserTaskId,
} from '../../components/execution/executionPresentation';
import LogViewer, { type LogViewerItem } from '../../components/execution/LogViewer';
import { NodeKindIcon } from '../../components/execution/NodeKindIcon';
import { isOfflineFlowNodeKind } from '../../components/execution/offlineNodeKinds';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ListShell } from '../../components/ui/list/ListShell';
import {
    computeNodeTimelineSpans,
    getInstanceStateLabel,
    getInstanceStateTone,
    getNodeInspectButtonLabel,
    isActiveInstanceState,
} from './instancePresentation';
import './OperationsExecutionDetailPage.css';
import './OperationsInstancePage.css';
import { OperationsNodeSnapshotDialog } from './OperationsNodeSnapshotDialog';
import { OperationsOverviewDag } from './OperationsOverviewDag';
import { OperationsRerunDialog } from './OperationsRerunDialog';

const LEVELS = ['ERROR', 'WARN', 'INFO'] as const;
const EMPTY_LOGS: OperationsExecutionLogEntry[] = [];

const PARAMETER_SOURCE_LABEL: Record<string, { label: string; tone: string }> = {
    MANUAL_OVERRIDE: { label: '手动覆盖', tone: 'warning' },
    SYSTEM_TIME: { label: '系统时间', tone: 'info' },
    EXPLICIT_INPUT: { label: '外部传入', tone: 'info' },
    RERUN: { label: '重跑沿用', tone: 'neutral' },
    CONSTANT: { label: '固定值', tone: 'neutral' },
};

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
    if (failedTask) return failedTask.taskId;
    const activeTask = taskRuns.find((task) => isActiveStatus(task.status));
    if (activeTask) return activeTask.taskId;
    const executedTask = taskRuns.find((task) => task.status !== 'SKIPPED');
    return executedTask?.taskId ?? taskRuns[0]?.taskId ?? undefined;
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

function DetailMetric({
    label,
    value,
    emphasized = false,
}: {
    label: string;
    value: React.ReactNode;
    emphasized?: boolean;
}) {
    return (
        <div className="operations-execution-metric">
            <span className="operations-execution-metric__label">{label}</span>
            <strong className={`operations-execution-metric__value${emphasized ? ' is-emphasized' : ''}`}>
                {value}
            </strong>
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
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'parameters'>('overview');
    const [overviewMode, setOverviewMode] = useState<'list' | 'dag'>('list');
    const [snapshotTaskId, setSnapshotTaskId] = useState<string | null>(null);
    const [dagSelectedTaskId, setDagSelectedTaskId] = useState<string | null>(null);
    const [rerunDialogOpen, setRerunDialogOpen] = useState(false);
    const [stopDialogOpen, setStopDialogOpen] = useState(false);
    const [markSuccessDialogOpen, setMarkSuccessDialogOpen] = useState(false);

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
        refetchInterval: (query) => (autoRefresh && isActiveInstanceState(query.state.data?.state) ? 5_000 : false),
    });

    const diagnosis: OperationsInstanceDiagnosis | null = diagnosisQuery.data
        ?? (locateQuery.data
            && locateQuery.data.branch === branch
            && locateQuery.data.flowId === flowId
            && locateQuery.data.scheduleKey === period
            ? locateQuery.data
            : null);
    const isDiagnosisActive = isActiveInstanceState(diagnosis?.state);

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
        refetchInterval: (query) => (
            autoRefresh && (isActiveStatus(query.state.data?.status) || isDiagnosisActive) ? 5_000 : false
        ),
    });
    const detail = detailQuery.data ?? null;
    const isExecutionActive = isActiveStatus(detail?.status);
    const isLivePolling = isDiagnosisActive || isExecutionActive;

    const visibleTaskRuns = useMemo(
        () => detail?.taskRuns.filter((task) => isUserTaskId(task.taskId)) ?? [],
        [detail],
    );
    const hasOverviewDag = Boolean(detail?.graphNodes && detail.graphNodes.length > 0);
    const overviewNodes = useMemo<OperationsExecutionGraphNode[]>(() => {
        if (detail?.graphNodes && detail.graphNodes.length > 0) {
            return detail.graphNodes;
        }
        return visibleTaskRuns.map((task) => ({
            taskId: task.taskId,
            kind: 'SHELL',
            dataSourceType: null,
            status: task.status,
            startDate: task.startDate,
            endDate: task.endDate,
            durationMs: task.durationMs,
            hasCodeSnapshot: false,
        }));
    }, [detail?.graphNodes, visibleTaskRuns]);
    const overviewEdges = useMemo<OperationsRerunGraphEdge[]>(
        () => detail?.graphEdges ?? [],
        [detail?.graphEdges],
    );
    const blockedUpstreamIds = useMemo(() => {
        if (overviewEdges.length === 0 || overviewNodes.length === 0) {
            return new Set<string>();
        }
        const adj = new Map<string, string[]>();
        for (const edge of overviewEdges) {
            const list = adj.get(edge.source);
            if (list) list.push(edge.target);
            else adj.set(edge.source, [edge.target]);
        }
        const blocked = new Set<string>();
        const queue: string[] = [];
        for (const node of overviewNodes) {
            if (getExecutionPresentation(node.status).dotTone === 'failed') {
                for (const next of adj.get(node.taskId) ?? []) {
                    if (!blocked.has(next)) {
                        blocked.add(next);
                        queue.push(next);
                    }
                }
            }
        }
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const next of adj.get(current) ?? []) {
                if (!blocked.has(next)) {
                    blocked.add(next);
                    queue.push(next);
                }
            }
        }
        return blocked;
    }, [overviewEdges, overviewNodes]);
    const skippedTaskCount = useMemo(
        () => overviewNodes.filter((task) => task.status === 'SKIPPED').length,
        [overviewNodes],
    );
    const notRunTaskCount = useMemo(
        () => overviewNodes.filter((task) => task.status === 'NOT_RUN').length,
        [overviewNodes],
    );
    const defaultTaskId = useMemo(
        () => (detail ? pickDefaultTaskId(visibleTaskRuns) : undefined),
        [detail, visibleTaskRuns],
    );

    const timelineSpans = useMemo(
        () => (detail
            ? computeNodeTimelineSpans(visibleTaskRuns, detail.startDate, detail.endDate)
            : new Map()),
        [detail, visibleTaskRuns],
    );

    useEffect(() => {
        setSelectedTaskId(undefined);
        setSnapshotTaskId(null);
        setDagSelectedTaskId(null);
        setActiveLevels(new Set());
        setSearchText('');
    }, [selectedExecutionId, groupId]);

    useEffect(() => {
        if (defaultTaskId === undefined || selectedTaskId !== undefined) return;
        setSelectedTaskId(defaultTaskId);
    }, [defaultTaskId, selectedTaskId]);

    const logsQuery = useQuery({
        queryKey: ['operations-execution-logs', groupId, selectedExecutionId, selectedTaskId],
        enabled: groupId != null && Boolean(detail) && selectedTaskId !== undefined && activeTab === 'logs',
        queryFn: () => getOperationsExecutionLogs(groupId ?? 0, selectedExecutionId ?? '', selectedTaskId ?? ''),
        refetchInterval: autoRefresh && isExecutionActive && activeTab === 'logs' ? 5_000 : false,
    });

    const rerunMutation = useMutation({
        mutationFn: (payload: OperationsExecutionRerunRequest) => rerunOperationsExecution(
            groupId ?? 0,
            selectedExecutionId ?? '',
            payload,
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

    const stopMutation = useMutation({
        mutationFn: () => stopOperationsExecution(groupId ?? 0, selectedExecutionId ?? ''),
        onSuccess: () => {
            setStopDialogOpen(false);
            showSuccess('已发送停止请求');
            void queryClient.invalidateQueries({ queryKey: ['operations-instance-diagnosis'] });
            void queryClient.invalidateQueries({ queryKey: ['operations-execution', groupId, selectedExecutionId] });
            void queryClient.invalidateQueries({ queryKey: ['operations-execution-logs', groupId, selectedExecutionId] });
        },
        onError: (error) => {
            showError(error, '停止任务失败');
        },
    });

    const markSuccessMutation = useMutation({
        mutationFn: () => markOperationsExecutionSuccess(groupId ?? 0, selectedExecutionId ?? ''),
        onSuccess: () => {
            setMarkSuccessDialogOpen(false);
            showSuccess('已置为成功');
            void queryClient.invalidateQueries({ queryKey: ['operations-instance-diagnosis'] });
            void queryClient.invalidateQueries({ queryKey: ['operations-execution', groupId, selectedExecutionId] });
            void queryClient.invalidateQueries({ queryKey: ['operations-executions'] });
        },
        onError: (error) => {
            showError(error, '置成功失败');
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

    const canOperate = systemAdmin || permissions.includes('offline.write');
    const canStop = Boolean(detail && (detail.stoppable ?? isStoppable(detail.status)) && canOperate);
    const canMarkSuccess = Boolean(detail && (detail.markableSuccess ?? isMarkableSuccess(detail.status)) && canOperate);
    const canRerun = Boolean(detail?.rerunnable && canOperate);
    const isForceSuccess = Boolean(detail && (detail.forceSuccess || detail.status === 'FORCE_SUCCESS'));
    const rawInputsEntries = detail ? Object.entries(detail.inputs ?? {}) : [];
    const parameterCount = detail
        ? (detail.parameters.length > 0
            ? detail.parameters.length
            : detail.parameterResolutionStatus === 'UNAVAILABLE'
                ? rawInputsEntries.length
                : 0)
        : 0;
    const isRefreshing = diagnosisQuery.isRefetching || detailQuery.isRefetching || logsQuery.isRefetching;
    const refreshAll = () => {
        void diagnosisQuery.refetch();
        void detailQuery.refetch();
        if (selectedTaskId !== undefined && activeTab === 'logs') {
            void logsQuery.refetch();
        }
    };

    const drillToUpstream = (upstream: OperationsInstanceUpstreamItem) => {
        if (!upstream.accessible || groupId == null || !branch || !flowId || !period) return;
        setTrail((previous) => [...previous, { group: groupId, branch, flowId, period }]);
        setDrawerOpen(false);
        setActiveTab('overview');
        const next: Record<string, string> = {
            group: String(upstream.groupId),
            branch,
            flowId: upstream.flowId,
            period: upstream.scheduleKey,
        };
        if (upstream.executionId) {
            next.execution = upstream.executionId;
        }
        setSearchParams(next);
    };

    const jumpToTrailEntry = (index: number) => {
        const target = trail[index];
        if (!target) return;
        setTrail((previous) => previous.slice(0, index));
        setActiveTab('overview');
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

    const formattedPlannedFireAt = formatBrowserDateTime(diagnosis.plannedFireAt);
    const formattedExecutionPlannedAt = detail ? formatBrowserDateTime(detail.plannedAt) : '—';
    const hasDistinctExecutionPlannedAt = Boolean(
        detail && diagnosis.plannedFireAt && detail.plannedAt && formattedPlannedFireAt !== formattedExecutionPlannedAt,
    );
    const showExecutionStatusMetric = Boolean(
        detail && (executions.length > 1 || (detail.status ?? '').toUpperCase() !== (diagnosis.state ?? '').toUpperCase()),
    );
    const diagnosisReasonTone = getInstanceStateTone(diagnosis.state);

    const resolvedFlowPath = detail?.flowPath ?? diagnosis?.flowPath ?? null;
    const isCrossGroup = currentGroupId != null && groupId != null && currentGroupId !== groupId;
    const executedNodeCount = Math.max(0, overviewNodes.length - skippedTaskCount - notRunTaskCount);
    const nodeCountBreakdown: string[] = [];
    if (skippedTaskCount > 0) nodeCountBreakdown.push(`${skippedTaskCount} 已跳过`);
    if (notRunTaskCount > 0) nodeCountBreakdown.push(`${notRunTaskCount} 未执行`);
    const nodeCountDisplay = nodeCountBreakdown.length > 0
        ? `${executedNodeCount} / ${overviewNodes.length}（${nodeCountBreakdown.join('，')}）`
        : overviewNodes.length;

    return (
        <div className="operations-execution-detail-page operations-instance-page">
            <header className="operations-execution-detail-header">
                <div className="operations-instance-header-identity">
                    <button
                        type="button"
                        className="operations-execution-detail-back"
                        onClick={() => navigate('/operations')}
                        aria-label="返回运维中心"
                    >
                        <ArrowLeft size={16} />
                        <span>返回列表</span>
                    </button>

                    <span className="operations-instance-header-divider" aria-hidden="true" />

                    <div className="operations-execution-detail-heading">
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
                        <div className="operations-execution-title-row">
                            <h1 title={diagnosis.flowId}>{diagnosis.flowId}</h1>
                            <StatusPill state={diagnosis.state} />
                        </div>
                        <div className="operations-instance-meta" aria-label="实例摘要">
                            <span className="operations-instance-meta__item">
                                <GitBranch size={12} aria-hidden="true" />
                                <code title={diagnosis.branch}>{diagnosis.branch}</code>
                            </span>
                            <span className="operations-instance-meta__sep" aria-hidden="true">·</span>
                            <span className="operations-instance-meta__item">
                                <span>Cron</span>
                                <code title={diagnosis.cron ?? ''}>{diagnosis.cron ?? '—'}</code>
                            </span>
                            <span className="operations-instance-meta__sep" aria-hidden="true">·</span>
                            <span className="operations-instance-meta__item">{diagnosis.timezone ?? '—'}</span>
                            <span className="operations-instance-meta__sep" aria-hidden="true">·</span>
                            <span className="operations-instance-meta__item">
                                <span>调度</span>
                                <span className={`operations-instance-schedule-flag${diagnosis.scheduleEnabled ? ' is-enabled' : ''}`}>
                                    {diagnosis.scheduleEnabled ? '已启用' : '已停用'}
                                </span>
                            </span>
                        </div>
                    </div>
                </div>

                <div className="operations-execution-detail-actions">
                    {resolvedFlowPath ? (
                        <button
                            type="button"
                            className="operations-instance-upstream-button"
                            disabled={isCrossGroup}
                            title={isCrossGroup ? '跨项目组任务，请先切换至对应项目组' : '在离线开发中打开该任务'}
                            onClick={() => {
                                const params = new URLSearchParams();
                                params.set('flowPath', resolvedFlowPath);
                                if (diagnosis.branch) {
                                    params.set('branch', diagnosis.branch);
                                }
                                navigate(`/offline?${params.toString()}`);
                            }}
                        >
                            <ExternalLink size={15} />
                            在离线开发中打开
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="operations-instance-upstream-button"
                        onClick={() => setDrawerOpen(true)}
                    >
                        <GitBranch size={15} />
                        上游实例{diagnosis.upstreams.length > 0 ? ` (${diagnosis.upstreams.length})` : ''}
                    </button>
                    {isLivePolling && (
                        <button
                            type="button"
                            className={`operations-execution-live-toggle${autoRefresh ? ' is-active' : ''}`}
                            aria-pressed={autoRefresh}
                            title={autoRefresh ? '每 5 秒自动刷新运行状态和日志，点击暂停' : '自动刷新已暂停，点击恢复'}
                            onClick={() => setAutoRefresh((current) => !current)}
                        >
                            <span className="operations-execution-live-toggle__dot" aria-hidden="true" />
                            {autoRefresh ? '自动刷新 5s' : '自动刷新已暂停'}
                        </button>
                    )}
                    <button
                        type="button"
                        className="operations-execution-icon-button"
                        onClick={refreshAll}
                        aria-label="刷新当前实例"
                        title="刷新当前实例"
                    >
                        <RefreshCw size={15} className={isRefreshing ? 'operations-execution-spin' : undefined} />
                    </button>
                    {canStop && (
                        <button
                            type="button"
                            className="operations-execution-stop"
                            onClick={() => setStopDialogOpen(true)}
                            disabled={stopMutation.isPending}
                        >
                            <Square size={14} />
                            停止任务
                        </button>
                    )}
                    {canMarkSuccess && (
                        <button
                            type="button"
                            className="operations-execution-mark-success"
                            onClick={() => setMarkSuccessDialogOpen(true)}
                            disabled={markSuccessMutation.isPending}
                        >
                            <CheckCheck size={15} />
                            置成功
                        </button>
                    )}
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
                {diagnosis.reason && executions.length > 0 && (
                    <div className={`operations-instance-reason operations-instance-reason--${diagnosisReasonTone}`} role="status">
                        {diagnosisReasonTone === 'failed' || diagnosisReasonTone === 'warning' ? (
                            <TriangleAlert size={15} className="operations-instance-reason__icon" aria-hidden="true" />
                        ) : (
                            <Info size={15} className="operations-instance-reason__icon" aria-hidden="true" />
                        )}
                        <span>{diagnosis.reason}</span>
                    </div>
                )}

                {executions.length > 1 && (
                    <section className="operations-instance-executions" aria-label="本期执行">
                        <span className="operations-instance-executions-label">本期共 {executions.length} 次执行</span>
                        {executions.map((item) => {
                            const rerunBadge = getRerunBadgeMeta(item);
                            return (
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
                                    {rerunBadge ? (
                                        <span
                                            className={`operations-instance-rerun-badge operations-instance-rerun-badge--${rerunBadge.kind}`}
                                            title={rerunBadge.title}
                                        >
                                            {rerunBadge.label}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </section>
                )}

                {executions.length === 0 ? (
                    <section className="operations-instance-empty" aria-label="无执行实例">
                        <StatusPill state={diagnosis.state} />
                        <p>{diagnosis.reason ?? '本期尚未产生执行。'}</p>
                        {diagnosis.plannedFireAt && (
                            <p className="operations-instance-empty-fire">
                                计划点火时间：{formattedPlannedFireAt}
                            </p>
                        )}
                    </section>
                ) : detailQuery.isLoading || !detail ? (
                    <div className="operations-execution-log-loading operations-execution-log-loading--standalone" role="status">
                        {Array.from({ length: 8 }).map((_, index) => (
                            <span key={index} />
                        ))}
                    </div>
                ) : detailQuery.isError ? (
                    <div className="operations-execution-empty-inline" role="alert">执行详情加载失败。</div>
                ) : (
                    <>
                        {executions.length === 1 && (() => {
                            const rerunBadge = getRerunBadgeMeta(executions[0]);
                            if (!rerunBadge) return null;
                            return (
                                <section className="operations-instance-executions" aria-label="本期执行">
                                    <span className="operations-instance-executions-label">
                                        {rerunBadge.kind === 'auto' ? '本次执行为自动重试' : '本次执行为手动重跑'}
                                    </span>
                                    <span
                                        className={`operations-instance-rerun-badge operations-instance-rerun-badge--${rerunBadge.kind}`}
                                        title={rerunBadge.title}
                                    >
                                        {rerunBadge.label}
                                    </span>
                                </section>
                            );
                        })()}
                        {isForceSuccess && (() => {
                            const metaParts: string[] = [];
                            if (detail.forceSuccessBy) metaParts.push(`操作人：${detail.forceSuccessBy}`);
                            if (detail.forceSuccessAt) metaParts.push(`操作时间：${formatBrowserDateTime(detail.forceSuccessAt)}`);
                            const metaSuffix = metaParts.length > 0 ? `（${metaParts.join('，')}）` : '';
                            return (
                                <div
                                    className="operations-instance-reason operations-instance-reason--forced-success"
                                    role="status"
                                >
                                    <CheckCheck size={15} className="operations-instance-reason__icon" aria-hidden="true" />
                                    <span>{`已人工置成功${metaSuffix}。下游等待任务已放行，原始失败节点与报错日志保持不变。`}</span>
                                </div>
                            );
                        })()}
                        <section className="operations-execution-summary" aria-label="执行摘要">
                            {showExecutionStatusMetric && (
                                <DetailMetric label="状态" value={<StatusPill state={detail.status} />} />
                            )}
                            {hasDistinctExecutionPlannedAt ? (
                                <>
                                    <DetailMetric label="计划点火时间" value={formattedPlannedFireAt} />
                                    <DetailMetric label="计划执行时间" value={formattedExecutionPlannedAt} />
                                </>
                            ) : (
                                <DetailMetric
                                    label="计划时间"
                                    value={detail.plannedAt ? formattedExecutionPlannedAt : formattedPlannedFireAt}
                                />
                            )}
                            <DetailMetric label="开始时间" value={formatBrowserDateTime(detail.startDate)} />
                            <DetailMetric label="结束时间" value={formatBrowserDateTime(detail.endDate)} />
                            <DetailMetric label="耗时" value={formatDuration(detail.durationMs)} emphasized />
                            <DetailMetric
                                label="节点数"
                                value={nodeCountDisplay}
                            />
                        </section>

                        <section className="operations-execution-board">
                            <div className="operations-execution-panel-header">
                                <div className="operations-execution-panel-tabs" role="tablist" aria-label="执行详情视图">
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={activeTab === 'overview'}
                                        className={`operations-execution-panel-tab${activeTab === 'overview' ? ' is-active' : ''}`}
                                        onClick={() => setActiveTab('overview')}
                                    >
                                        <LayoutList size={14} />
                                        运行概览
                                        {overviewNodes.length > 0 ? (
                                            <span className="operations-execution-panel-tab__badge">{overviewNodes.length}</span>
                                        ) : null}
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={activeTab === 'logs'}
                                        className={`operations-execution-panel-tab${activeTab === 'logs' ? ' is-active' : ''}`}
                                        onClick={() => setActiveTab('logs')}
                                    >
                                        <Terminal size={14} />
                                        执行日志
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={activeTab === 'parameters'}
                                        className={`operations-execution-panel-tab${activeTab === 'parameters' ? ' is-active' : ''}`}
                                        onClick={() => setActiveTab('parameters')}
                                    >
                                        <SlidersHorizontal size={14} />
                                        运行参数
                                        {parameterCount > 0 ? (
                                            <span className="operations-execution-panel-tab__badge">{parameterCount}</span>
                                        ) : null}
                                    </button>
                                </div>

                                {activeTab === 'overview' && hasOverviewDag && (
                                    <div className="operations-overview-view-switch" role="group" aria-label="概览视图切换">
                                        <button
                                            type="button"
                                            aria-pressed={overviewMode === 'list'}
                                            className={`operations-overview-view-btn${overviewMode === 'list' ? ' is-active' : ''}`}
                                            onClick={() => setOverviewMode('list')}
                                        >
                                            <LayoutList size={13} aria-hidden="true" />
                                            列表
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={overviewMode === 'dag'}
                                            className={`operations-overview-view-btn${overviewMode === 'dag' ? ' is-active' : ''}`}
                                            onClick={() => setOverviewMode('dag')}
                                        >
                                            <Network size={13} aria-hidden="true" />
                                            DAG 图
                                        </button>
                                    </div>
                                )}

                                {activeTab === 'logs' && (
                                    <div className="operations-execution-log-tools">
                                        <div className="operations-execution-levels" aria-label="日志级别">
                                            {LEVELS.map((level) => {
                                                const count = levelCounts[level] ?? 0;
                                                const active = activeLevels.has(level);
                                                const zero = count === 0 && !active;
                                                const dimmed = activeLevels.size > 0 && !active;
                                                return (
                                                    <button
                                                        key={level}
                                                        type="button"
                                                        className={`operations-execution-level operations-execution-level--${level.toLowerCase()}${zero ? ' is-zero' : ''}${dimmed ? ' is-dimmed' : ''}${active ? ' is-active' : ''}`}
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
                                                        {level} {count}
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
                                )}
                            </div>

                            {activeTab === 'overview' ? (
                                <section
                                    className={`operations-overview-panel${overviewMode === 'dag' && hasOverviewDag ? ' is-dag' : ''}`}
                                    role="tabpanel"
                                    aria-label="运行概览"
                                >
                                    {overviewNodes.length === 0 ? (
                                        <div className="operations-execution-params__empty">暂无节点执行记录。</div>
                                    ) : overviewMode === 'dag' && hasOverviewDag ? (
                                        <OperationsOverviewDag
                                            nodes={overviewNodes}
                                            edges={overviewEdges}
                                            blockedUpstreamIds={blockedUpstreamIds}
                                            isExecutionActive={isExecutionActive}
                                            selectedTaskId={dagSelectedTaskId}
                                            onSelectTask={setDagSelectedTaskId}
                                            onInspectNode={setSnapshotTaskId}
                                            onViewLogs={(taskId) => {
                                                setSelectedTaskId(taskId);
                                                setActiveTab('logs');
                                            }}
                                        />
                                    ) : (
                                        <div className="operations-overview-table-wrap">
                                            <table className="operations-overview-table" aria-label="节点运行情况">
                                                <thead>
                                                    <tr>
                                                        <th>节点</th>
                                                        <th>状态</th>
                                                        <th>开始时间</th>
                                                        <th>结束时间</th>
                                                        <th className="is-right">耗时</th>
                                                        <th>时间分布</th>
                                                        <th className="is-right">操作</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {overviewNodes.map((task) => {
                                                        const tone = getExecutionPresentation(task.status).dotTone;
                                                        const Icon = getTaskStatusIcon(task.status);
                                                        const isSkipped = task.status === 'SKIPPED';
                                                        const isNotRun = task.status === 'NOT_RUN';
                                                        const span = timelineSpans.get(task.taskId);
                                                        const statusLabel = isNotRun
                                                            ? (blockedUpstreamIds.has(task.taskId)
                                                                ? '未执行（上游失败）'
                                                                : isExecutionActive
                                                                    ? '等待执行'
                                                                    : '未执行')
                                                            : getExecutionStatusLabel(task.status);
                                                        return (
                                                            <tr
                                                                key={task.taskId}
                                                                className={`${isSkipped ? 'is-skipped ' : ''}${isNotRun ? 'is-not-run ' : ''}${tone === 'failed' ? 'is-failed' : ''}`.trim() || undefined}
                                                            >
                                                                <td>
                                                                    <span className="operations-overview-node-cell">
                                                                        {hasOverviewDag ? (
                                                                            <NodeKindIcon
                                                                                kind={isOfflineFlowNodeKind(task.kind) ? task.kind : 'SHELL'}
                                                                                size={14}
                                                                                decorative
                                                                            />
                                                                        ) : null}
                                                                        <span className="operations-overview-node-id" title={task.taskId}>
                                                                            {task.taskId}
                                                                        </span>
                                                                    </span>
                                                                </td>
                                                                <td>
                                                                    <span className={`operations-execution-status operations-execution-status--${tone}`}>
                                                                        <Icon size={13} className={isRunningStatus(task.status) ? 'operations-execution-spin' : undefined} />
                                                                        {statusLabel}
                                                                    </span>
                                                                </td>
                                                                <td className="is-mono">{formatBrowserDateTime(task.startDate)}</td>
                                                                <td className="is-mono">{formatBrowserDateTime(task.endDate)}</td>
                                                                <td className="is-mono is-right">{formatDuration(task.durationMs)}</td>
                                                                <td>
                                                                    {span?.hasBar ? (
                                                                        <div
                                                                            className="operations-timeline-track"
                                                                            title={`${formatBrowserDateTime(task.startDate)} → ${formatBrowserDateTime(task.endDate)} (${formatDuration(task.durationMs)})`}
                                                                        >
                                                                            <span
                                                                                className={`operations-timeline-bar operations-timeline-bar--${tone}`}
                                                                                style={{
                                                                                    left: `${span.leftPct}%`,
                                                                                    width: `${span.widthPct}%`,
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <span className="operations-timeline-empty">—</span>
                                                                    )}
                                                                </td>
                                                                <td className="is-right">
                                                                    <div className="operations-overview-actions">
                                                                        {task.hasCodeSnapshot ? (
                                                                            <button
                                                                                type="button"
                                                                                className="operations-overview-log-btn"
                                                                                onClick={() => setSnapshotTaskId(task.taskId)}
                                                                            >
                                                                                <Code2 size={13} aria-hidden="true" />
                                                                                {getNodeInspectButtonLabel(task.kind)}
                                                                            </button>
                                                                        ) : null}
                                                                        <button
                                                                            type="button"
                                                                            className="operations-overview-log-btn"
                                                                            disabled={isNotRun}
                                                                            title={isNotRun ? '该节点未执行，暂无日志' : undefined}
                                                                            aria-label={`查看 ${task.taskId} 日志`}
                                                                            onClick={() => {
                                                                                setSelectedTaskId(task.taskId);
                                                                                setActiveTab('logs');
                                                                            }}
                                                                        >
                                                                            <Terminal size={13} aria-hidden="true" />
                                                                            查看日志
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </section>
                            ) : activeTab === 'logs' ? (
                                <div className="operations-execution-logs-split" role="tabpanel" aria-label="执行日志">
                                    <aside className="operations-execution-tasks" aria-label="节点列表">
                                        <div className="operations-execution-tasks-header">
                                            <span>执行节点</span>
                                            <span className="operations-execution-tasks-count">{visibleTaskRuns.length}</span>
                                        </div>
                                        <ListShell
                                            state={visibleTaskRuns.length === 0 ? 'empty' : 'ready'}
                                            className="operations-instance-list-shell"
                                            emptyTitle="暂无节点"
                                        >
                                            <div className="operations-execution-task-list">
                                                {visibleTaskRuns.map((task) => {
                                                    const tone = getExecutionPresentation(task.status).dotTone;
                                                    const Icon = getTaskStatusIcon(task.status);
                                                    const isSkipped = task.status === 'SKIPPED';
                                                    return (
                                                        <button
                                                            key={task.taskId}
                                                            type="button"
                                                            className={`operations-execution-task${selectedTaskId === task.taskId ? ' is-active' : ''}${isSkipped ? ' is-skipped' : ''}`}
                                                            onClick={() => {
                                                                setSelectedTaskId(task.taskId);
                                                            }}
                                                            aria-label={`查看 ${task.taskId} 日志`}
                                                        >
                                                            <span className="operations-execution-task__main">
                                                                <span className="operations-execution-task__name" title={task.taskId}>{task.taskId}</span>
                                                                <span className={`operations-execution-status operations-execution-status--${tone}`}>
                                                                    <Icon size={13} className={isRunningStatus(task.status) ? 'operations-execution-spin' : undefined} />
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
                                        </ListShell>
                                    </aside>

                                    <div className="operations-execution-logs">
                                        <div className="operations-execution-log-frame">
                                            <div className="operations-execution-log-surface">
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
                                                        hideTaskColumn
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <section className="operations-execution-params" role="tabpanel" aria-label="运行参数">
                                        {detail.parameterSnapshotChanged === true ? (
                                            <div className="operations-execution-params__notice" role="alert">
                                                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                                                <span>原执行之后任务的参数定义已更新，下方展示本次执行时的实际解析值。</span>
                                            </div>
                                        ) : null}

                                        {detail.parameterResolutionStatus === 'NONE' ? (
                                            <div className="operations-execution-params__empty">本次执行未配置参数。</div>
                                        ) : detail.parameterResolutionStatus === 'PENDING' ? (
                                            <div className="operations-execution-params__empty">参数尚未解析完成，任务启动后将自动更新。</div>
                                        ) : detail.parameterResolutionStatus === 'UNAVAILABLE' ? (
                                            <>
                                                <div className="operations-execution-params__notice" role="alert">
                                                    <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                                                    <span>原执行的参数快照不可用，无法还原完整解析来源；以下为原始输入参数。</span>
                                                </div>
                                                {rawInputsEntries.length > 0 ? (
                                                    <div className="operations-execution-params__table-wrap">
                                                        <table className="operations-params-table">
                                                            <thead>
                                                                <tr>
                                                                    <th>参数名</th>
                                                                    <th>原始输入值</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {rawInputsEntries.map(([key, value]) => (
                                                                    <tr key={key}>
                                                                        <td><code>{key}</code></td>
                                                                        <td><code>{value}</code></td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <div className="operations-execution-params__empty">无原始输入参数。</div>
                                                )}
                                            </>
                                        ) : detail.parameters.length === 0 ? (
                                            <div className="operations-execution-params__empty">本次执行未配置参数。</div>
                                        ) : (
                                            <div className="operations-execution-params__table-wrap">
                                                <table className="operations-params-table">
                                                    <thead>
                                                        <tr>
                                                            <th>参数名</th>
                                                            <th>类型</th>
                                                            <th>实际解析值</th>
                                                            <th>来源</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {detail.parameters.map((param) => {
                                                            const sourceMeta = PARAMETER_SOURCE_LABEL[param.source] ?? {
                                                                label: param.source,
                                                                tone: 'neutral',
                                                            };
                                                            const displayValue = param.value === null
                                                                ? '—'
                                                                : param.value === ''
                                                                    ? '""'
                                                                    : param.value;
                                                            return (
                                                                <tr key={param.key}>
                                                                    <td><code>{param.key}</code></td>
                                                                    <td><code>{param.dataType}</code></td>
                                                                    <td><code>{displayValue}</code></td>
                                                                    <td>
                                                                        <span className={`operations-param-source operations-param-source--${sourceMeta.tone}`}>
                                                                            {sourceMeta.label}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                </section>
                            )}
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
                            <div className="operations-instance-drawer-title">
                                <h2>上游实例</h2>
                                {diagnosis.upstreams.length > 0 ? (
                                    <span className="operations-execution-tasks-count">{diagnosis.upstreams.length}</span>
                                ) : null}
                            </div>
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
                            <ListShell
                                state={diagnosis.upstreams.length === 0 ? 'empty' : 'ready'}
                                className="operations-instance-list-shell"
                                emptyTitle="本任务没有配置上游依赖"
                            >
                                {diagnosis.upstreams.map((upstream) => {
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
                                            <div className="operations-instance-upstream-head">
                                                <div className="operations-instance-upstream-main">
                                                    <span className="operations-instance-upstream-name" title={displayName}>
                                                        {!upstream.accessible && <Lock size={13} aria-label="无权限" />}
                                                        {displayName}
                                                    </span>
                                                    <span className={`operations-instance-upstream-gate${upstream.satisfied ? ' is-satisfied' : ' is-waiting'}`}>
                                                        {upstream.satisfied ? '已满足闸门' : '未满足闸门'}
                                                    </span>
                                                </div>
                                                <div className="operations-instance-upstream-right">
                                                    <StatusPill state={upstream.state} />
                                                    {upstream.accessible ? (
                                                        <ChevronRight size={14} className="operations-instance-upstream-arrow" aria-hidden="true" />
                                                    ) : null}
                                                </div>
                                            </div>
                                            <dl className="operations-instance-upstream-times">
                                                <div>
                                                    <dt>计划开始</dt>
                                                    <dd>{formatBrowserDateTime(upstream.plannedAt)}</dd>
                                                </div>
                                                <div>
                                                    <dt>实际开始</dt>
                                                    <dd>{formatBrowserDateTime(upstream.startDate)}</dd>
                                                </div>
                                                <div>
                                                    <dt>结束时间</dt>
                                                    <dd>{formatBrowserDateTime(upstream.endDate)}</dd>
                                                </div>
                                                <div>
                                                    <dt>耗时</dt>
                                                    <dd>{formatDuration(upstream.durationMs)}</dd>
                                                </div>
                                            </dl>
                                        </button>
                                    );
                                })}
                            </ListShell>
                        </div>
                    </aside>
                </div>
            )}

            <OperationsNodeSnapshotDialog
                open={snapshotTaskId != null}
                groupId={groupId}
                executionId={selectedExecutionId}
                taskId={snapshotTaskId}
                onClose={() => setSnapshotTaskId(null)}
            />
            <OperationsRerunDialog
                open={rerunDialogOpen}
                groupId={groupId}
                executionId={selectedExecutionId}
                detail={detail}
                pending={rerunMutation.isPending}
                onOpenChange={setRerunDialogOpen}
                onConfirm={(payload) => rerunMutation.mutate(payload)}
            />
            <ConfirmDialog
                open={stopDialogOpen}
                onOpenChange={(open) => {
                    if (!open && !stopMutation.isPending) setStopDialogOpen(false);
                }}
                title="确认停止任务"
                description={`将向 Kestra 发送停止指令，中断任务「${diagnosis.flowId}」的当前执行。已执行完成的节点不会自动回滚。`}
                confirmText="确认停止"
                variant="destructive"
                icon="warning"
                isLoading={stopMutation.isPending}
                onConfirm={() => stopMutation.mutate()}
            />
            <ConfirmDialog
                open={markSuccessDialogOpen}
                onOpenChange={(open) => {
                    if (!open && !markSuccessMutation.isPending) setMarkSuccessDialogOpen(false);
                }}
                title="确认置成功"
                description={`将任务「${diagnosis.flowId}」的本次执行状态置为「人工置成功」。下游等待任务将自动放行，原始失败节点与报错日志会完整保留；置成功后本次执行不可再重跑。`}
                confirmText="确认置成功"
                variant="success"
                icon="success"
                isLoading={markSuccessMutation.isPending}
                onConfirm={() => markSuccessMutation.mutate()}
            />
        </div>
    );
}
