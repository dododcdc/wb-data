import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    RefreshCw,
    RotateCcw,
    Search,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    rerunOperationsExecution,
    type OperationsExecutionLogEntry,
    type OperationsExecutionTaskRun,
} from '../../api/operations';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
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
import './OperationsExecutionDetailPage.css';
import { OperationsRerunDialog } from './OperationsRerunDialog';

const LEVELS = ['ERROR', 'WARN', 'INFO'] as const;
const EMPTY_LOGS: OperationsExecutionLogEntry[] = [];

function getStatusTone(status: string | null | undefined) {
    return getExecutionPresentation(status).dotTone;
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
    const failedTask = taskRuns.find((task) => getStatusTone(task.status) === 'failed');
    return failedTask?.taskId ?? taskRuns[0]?.taskId ?? null;
}

function TaskStatus({ status }: { status: string | null | undefined }) {
    const tone = getStatusTone(status);
    const Icon = getTaskStatusIcon(status);

    return (
        <span className={`operations-execution-status operations-execution-status--${tone}`}>
            <Icon size={14} className={isRunningStatus(status) ? 'operations-execution-spin' : undefined} />
            {getExecutionStatusLabel(status)}
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

function TaskRunButton({
    task,
    active,
    onSelect,
}: {
    task: OperationsExecutionTaskRun;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            className={`operations-execution-task${active ? ' is-active' : ''}`}
            onClick={onSelect}
            aria-label={`查看 ${task.taskId} 日志`}
        >
            <span className="operations-execution-task__main">
                <span className="operations-execution-task__name" title={task.taskId}>{task.taskId}</span>
                <TaskStatus status={task.status} />
            </span>
            <span className="operations-execution-task__meta">
                <span>{formatBrowserDateTime(task.startDate)}</span>
                <span>{formatDuration(task.durationMs)}</span>
            </span>
        </button>
    );
}

export default function OperationsExecutionDetailPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { executionId } = useParams<{ executionId: string }>();
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const { showFeedback } = useOperationFeedback();
    const groupId = currentGroup?.id ?? null;
    const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
    const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
    const [searchText, setSearchText] = useState('');
    const [rerunDialogOpen, setRerunDialogOpen] = useState(false);

    const detailQuery = useQuery({
        queryKey: ['operations-execution', groupId, executionId],
        enabled: groupId != null && Boolean(executionId),
        queryFn: () => getOperationsExecution(groupId ?? 0, executionId ?? ''),
    });

    const detail = detailQuery.data ?? null;
    const visibleTaskRuns = useMemo(
        () => detail?.taskRuns.filter((task) => isUserTaskId(task.taskId)) ?? [],
        [detail],
    );
    const defaultTaskId = useMemo(() => (detail ? pickDefaultTaskId(visibleTaskRuns) : undefined), [detail, visibleTaskRuns]);

    useEffect(() => {
        setSelectedTaskId(undefined);
        setActiveLevels(new Set());
        setSearchText('');
    }, [executionId, groupId]);

    useEffect(() => {
        if (defaultTaskId === undefined || selectedTaskId !== undefined) return;
        setSelectedTaskId(defaultTaskId);
    }, [defaultTaskId, selectedTaskId]);

    const logsQuery = useQuery({
        queryKey: ['operations-execution-logs', groupId, executionId, selectedTaskId],
        enabled: groupId != null && Boolean(executionId) && Boolean(detail) && selectedTaskId !== undefined,
        queryFn: () => getOperationsExecutionLogs(groupId ?? 0, executionId ?? '', selectedTaskId ?? ''),
    });

    const rerunMutation = useMutation({
        mutationFn: (reuseManualOverrides: boolean) => rerunOperationsExecution(
            groupId ?? 0,
            executionId ?? '',
            { reuseManualOverrides },
        ),
        onSuccess: () => {
            setRerunDialogOpen(false);
            showFeedback({ tone: 'success', title: '已触发重跑', detail: '' });
            void queryClient.invalidateQueries({ queryKey: ['operations-executions'] });
            void queryClient.invalidateQueries({ queryKey: ['operations-execution', groupId, executionId] });
        },
        onError: () => {
            showFeedback({ tone: 'error', title: '重跑触发失败', detail: '请稍后再试。' });
        },
    });

    const logs = logsQuery.data ?? EMPTY_LOGS;
    const levelCounts = useMemo(() => computeLogLevelCounts(logs), [logs]);
    const logItems = useMemo<LogViewerItem[]>(() => {
        return logs
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
            }));
    }, [activeLevels, logs]);

    const canRerun = Boolean(detail?.rerunnable && (systemAdmin || permissions.includes('offline.write')));
    const isRefreshing = detailQuery.isRefetching || logsQuery.isRefetching;
    const refreshCurrentExecution = () => {
        void detailQuery.refetch();
        void logsQuery.refetch();
    };

    if (!groupId || !executionId) {
        return (
            <div className="operations-execution-detail-page">
                <div className="operations-execution-empty">请先选择项目组。</div>
            </div>
        );
    }

    if (detailQuery.isLoading) {
        return (
            <div className="operations-execution-detail-page">
                <div className="operations-execution-loading" role="status">正在加载执行详情...</div>
            </div>
        );
    }

    if (detailQuery.isError) {
        return (
            <div className="operations-execution-detail-page">
                <div className="operations-execution-empty">执行详情加载失败。</div>
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="operations-execution-detail-page">
                <div className="operations-execution-empty">未找到这条执行记录。</div>
            </div>
        );
    }

    return (
        <div className="operations-execution-detail-page animate-enter">
            <header className="operations-execution-detail-header">
                <button
                    type="button"
                    className="operations-execution-detail-back"
                    onClick={() => navigate('/operations')}
                    aria-label="返回运维中心"
                >
                    <ArrowLeft size={17} />
                    <span>返回列表</span>
                </button>

                <div className="operations-execution-detail-heading">
                    <div className="operations-execution-title-row">
                        <h1 title={detail.flowId}>{detail.flowId}</h1>
                        <TaskStatus status={detail.status} />
                    </div>
                </div>

                <div className="operations-execution-detail-actions">
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
                <section className="operations-execution-summary" aria-label="执行摘要">
                    <DetailMetric label="分支" value={<span title={detail.branch}>{detail.branch}</span>} />
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
                            ) : visibleTaskRuns.map((task) => (
                                <TaskRunButton
                                    key={task.taskId}
                                    task={task}
                                    active={selectedTaskId === task.taskId}
                                    onSelect={() => setSelectedTaskId(task.taskId)}
                                />
                            ))}
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
                                                setActiveLevels((prev) => {
                                                    const next = new Set(prev);
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
                                <button
                                    type="button"
                                    className="operations-execution-icon-button"
                                    onClick={refreshCurrentExecution}
                                    aria-label="刷新当前执行"
                                    title="刷新当前执行"
                                >
                                    <RefreshCw size={15} className={isRefreshing ? 'operations-execution-spin' : undefined} />
                                </button>
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
            </main>
            <OperationsRerunDialog
                open={rerunDialogOpen}
                groupId={groupId}
                executionId={executionId}
                detail={detail}
                pending={rerunMutation.isPending}
                onOpenChange={setRerunDialogOpen}
                onConfirm={(reuseManualOverrides) => rerunMutation.mutate(reuseManualOverrides)}
            />
        </div>
    );
}
