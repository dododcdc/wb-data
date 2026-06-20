import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    Clock,
    LoaderCircle,
    RefreshCw,
    RotateCcw,
    Search,
    XCircle,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import {
    getOperationsExecution,
    getOperationsExecutionLogs,
    rerunOperationsExecution,
    type OperationsExecutionDetail,
    type OperationsExecutionLogEntry,
    type OperationsExecutionTaskRun,
} from '../../api/operations';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { formatBrowserDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import './OperationsExecutionDetailPage.css';

const LEVELS = ['ERROR', 'WARN', 'INFO'] as const;
const EMPTY_LOGS: OperationsExecutionLogEntry[] = [];

function getStatusLabel(status: string | null | undefined) {
    if (status === 'SUCCESS') return '成功';
    if (status === 'FAILED') return '失败';
    if (status === 'CANCELLED') return '已取消';
    if (status === 'KILLED') return '已停止';
    if (status === 'RUNNING') return '执行中';
    if (status === 'RETRYING') return '重试中';
    if (status === 'PAUSED') return '已暂停';
    if (status === 'QUEUED' || status === 'CREATED') return '就绪';
    return status || '未知';
}

function getStatusTone(status: string | null | undefined) {
    if (status === 'SUCCESS') return 'success';
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'KILLED') return 'failed';
    if (status === 'RUNNING' || status === 'RETRYING' || status === 'PAUSED') return 'running';
    return 'neutral';
}

function getStatusIcon(status: string | null | undefined) {
    if (status === 'SUCCESS') return CheckCircle2;
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'KILLED') return XCircle;
    if (status === 'RUNNING' || status === 'RETRYING') return LoaderCircle;
    return Clock;
}

function shouldSpinStatusIcon(status: string | null | undefined) {
    return status === 'RUNNING' || status === 'RETRYING';
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

function pickDefaultTaskId(detail: OperationsExecutionDetail) {
    const failedTask = detail.taskRuns.find((task) => getStatusTone(task.status) === 'failed');
    return failedTask?.taskId ?? detail.taskRuns[0]?.taskId ?? null;
}

function countLevels(logs: OperationsExecutionLogEntry[]) {
    return logs.reduce<Record<string, number>>((acc, entry) => {
        const level = entry.level ?? 'INFO';
        acc[level] = (acc[level] ?? 0) + 1;
        return acc;
    }, {});
}

function formatLogTime(timestamp: string | null | undefined) {
    if (!timestamp) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(timestamp));
}

function renderHighlightedMessage(message: string, query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return message;

    const lowerMessage = message.toLowerCase();
    const lowerQuery = normalizedQuery.toLowerCase();
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let next = lowerMessage.indexOf(lowerQuery);

    while (next !== -1) {
        if (next > cursor) {
            parts.push(message.slice(cursor, next));
        }
        const end = next + normalizedQuery.length;
        parts.push(<mark key={`${next}-${end}`}>{message.slice(next, end)}</mark>);
        cursor = end;
        next = lowerMessage.indexOf(lowerQuery, cursor);
    }

    if (cursor < message.length) {
        parts.push(message.slice(cursor));
    }

    return parts;
}

function TaskStatus({ status }: { status: string | null | undefined }) {
    const tone = getStatusTone(status);
    const Icon = getStatusIcon(status);

    return (
        <span className={`operations-execution-status operations-execution-status--${tone}`}>
            <Icon size={14} className={shouldSpinStatusIcon(status) ? 'operations-execution-spin' : undefined} />
            {getStatusLabel(status)}
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
    const [selectedTaskId, setSelectedTaskId] = useState<string | null | undefined>(undefined);
    const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
    const [searchText, setSearchText] = useState('');

    const detailQuery = useQuery({
        queryKey: ['operations-execution', groupId, executionId],
        enabled: groupId != null && Boolean(executionId),
        queryFn: () => getOperationsExecution(groupId ?? 0, executionId ?? ''),
    });

    const detail = detailQuery.data ?? null;
    const defaultTaskId = useMemo(() => (detail ? pickDefaultTaskId(detail) : undefined), [detail]);

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
        queryKey: ['operations-execution-logs', groupId, executionId, selectedTaskId ?? 'all'],
        enabled: groupId != null && Boolean(executionId) && Boolean(detail) && selectedTaskId !== undefined,
        queryFn: () => getOperationsExecutionLogs(groupId ?? 0, executionId ?? '', selectedTaskId ?? null),
    });

    const rerunMutation = useMutation({
        mutationFn: () => rerunOperationsExecution(groupId ?? 0, executionId ?? ''),
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '已触发重跑', detail: '' });
            void queryClient.invalidateQueries({ queryKey: ['operations-executions'] });
            void queryClient.invalidateQueries({ queryKey: ['operations-execution', groupId, executionId] });
        },
        onError: () => {
            showFeedback({ tone: 'error', title: '重跑触发失败', detail: '请稍后再试。' });
        },
    });

    const logs = logsQuery.data ?? EMPTY_LOGS;
    const levelCounts = useMemo(() => countLevels(logs), [logs]);
    const filteredLogs = useMemo(() => {
        const query = searchText.trim().toLowerCase();
        return logs.filter((log) => {
            const level = log.level ?? 'INFO';
            if (activeLevels.size > 0 && !activeLevels.has(level)) return false;
            if (query && !(log.message ?? '').toLowerCase().includes(query)) return false;
            return true;
        });
    }, [activeLevels, logs, searchText]);

    const canRerun = Boolean(detail?.rerunnable && (systemAdmin || permissions.includes('offline.write')));
    const selectedTaskLabel = selectedTaskId ?? '全部日志';

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
                    <p title={detail.id}>{detail.id}</p>
                </div>

                <div className="operations-execution-detail-actions">
                    <button
                        type="button"
                        className="operations-execution-icon-button"
                        onClick={() => {
                            void detailQuery.refetch();
                            void logsQuery.refetch();
                        }}
                        aria-label="刷新执行详情"
                    >
                        <RefreshCw size={16} className={detailQuery.isRefetching || logsQuery.isRefetching ? 'operations-execution-spin' : undefined} />
                    </button>
                    {canRerun && (
                        <button
                            type="button"
                            className="operations-execution-rerun"
                            onClick={() => rerunMutation.mutate()}
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
                    <DetailMetric label="触发时间" value={formatBrowserDateTime(detail.createdAt)} />
                    <DetailMetric label="开始时间" value={formatBrowserDateTime(detail.startDate)} />
                    <DetailMetric label="结束时间" value={formatBrowserDateTime(detail.endDate)} />
                    <DetailMetric label="耗时" value={formatDuration(detail.durationMs)} />
                    <DetailMetric label="节点数" value={detail.taskRuns.length} />
                </section>

                {detail.failureSummary && (
                    <section className="operations-execution-failure" role="alert">
                        <AlertTriangle size={17} />
                        <span>{detail.failureSummary}</span>
                    </section>
                )}

                <section className="operations-execution-workspace">
                    <aside className="operations-execution-tasks" aria-label="节点列表">
                        <div className="operations-execution-panel-title">
                            <h2>节点</h2>
                            <button
                                type="button"
                                className={`operations-execution-all-logs${selectedTaskId === null ? ' is-active' : ''}`}
                                onClick={() => setSelectedTaskId(null)}
                            >
                                全部日志
                            </button>
                        </div>

                        <div className="operations-execution-task-list">
                            {detail.taskRuns.length === 0 ? (
                                <div className="operations-execution-empty-inline">暂无节点。</div>
                            ) : detail.taskRuns.map((task) => (
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
                        <div className="operations-execution-log-header">
                            <div>
                                <h2>日志</h2>
                                <p title={selectedTaskLabel}>{selectedTaskLabel}</p>
                            </div>
                            <button
                                type="button"
                                className="operations-execution-icon-button"
                                onClick={() => void logsQuery.refetch()}
                                aria-label="刷新日志"
                            >
                                <RefreshCw size={15} className={logsQuery.isRefetching ? 'operations-execution-spin' : undefined} />
                            </button>
                        </div>

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
                        ) : filteredLogs.length === 0 ? (
                            <div className="operations-execution-empty-inline">暂无日志。</div>
                        ) : (
                            <ol className="operations-execution-log-list">
                                {filteredLogs.map((log, index) => {
                                    const level = log.level ?? 'INFO';
                                    const message = log.message ?? '';
                                    return (
                                        <li key={`${log.timestamp ?? 'log'}-${index}`} className="operations-execution-log-line">
                                            <time>{formatLogTime(log.timestamp)}</time>
                                            <span className={`operations-execution-log-level operations-execution-log-level--${level.toLowerCase()}`}>{level}</span>
                                            <span className="operations-execution-log-task" title={log.taskId ?? ''}>{log.taskId ?? 'flow'}</span>
                                            <p>{renderHighlightedMessage(message, searchText)}</p>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </section>
                </section>
            </main>
        </div>
    );
}
