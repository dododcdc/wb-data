import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LayoutList, ListFilter } from 'lucide-react';
import {
    getOfflineExecution,
    getOfflineExecutionLogs,
    type OfflineExecutionDetail,
    type OfflineExecutionLogEntry,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import { useAuthStore } from '../../utils/auth';
import { getErrorMessage } from '../../utils/error';
import { 
    getExecutionPresentation, 
    getExecutionStatusLabel, 
    getTaskStatusIcon,
    isRunningStatus,
} from './executionPresentation';
import './ExecutionDetailPage.css';

function formatDateTime(value: string | null | undefined) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDuration(start: string | null, end: string | null) {
    if (!start || !end) return '—';
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    if (durationMs < 0) return '—';
    const seconds = durationMs / 1000;
    return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
}

export default function ExecutionDetailPage() {
    const navigate = useNavigate();
    const { executionId } = useParams<{ executionId: string }>();
    const [searchParams] = useSearchParams();
    const initialTaskId = searchParams.get('taskId');
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const groupId = currentGroup?.id ?? null;

    const [detail, setDetail] = useState<OfflineExecutionDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [logs, setLogs] = useState<OfflineExecutionLogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);

    useEffect(() => {
        setDetail(null);
        setDetailError(null);
        setLogs([]);
        setLogsError(null);
        setSelectedTaskId(initialTaskId);
    }, [executionId, groupId]);

    useEffect(() => {
        if (!groupId || !executionId) {
            return;
        }
        let cancelled = false;
        setDetailLoading(true);
        setDetailError(null);
        void getOfflineExecution(groupId, executionId)
            .then((nextDetail) => {
                if (!cancelled) {
                    setDetail(nextDetail);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setDetailError(getErrorMessage(error, '暂时无法读取执行详情。'));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setDetailLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [executionId, groupId]);

    useEffect(() => {
        if (!groupId || !executionId) {
            return;
        }
        let cancelled = false;
        setLogsLoading(true);
        setLogsError(null);
        void getOfflineExecutionLogs(groupId, executionId, selectedTaskId)
            .then((nextLogs) => {
                if (!cancelled) {
                    setLogs(nextLogs);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setLogsError(getErrorMessage(error, '暂时无法读取执行日志。'));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLogsLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [executionId, groupId, selectedTaskId]);

    const presentation = getExecutionPresentation(detail?.status);

    return (
        <div className="offline-execution-page">
            <header className="offline-execution-page-header">
                <Button type="button" variant="outline" size="sm" onClick={() => navigate('/offline')}>
                    <ArrowLeft size={14} />
                    返回离线开发
                </Button>
                <div className="offline-execution-page-heading">
                    <h1>执行详情</h1>
                    <p>{detail?.flowPath ?? executionId ?? '未指定执行记录'}</p>
                </div>
            </header>

            {!groupId || !executionId ? (
                <div className="offline-execution-page-empty">缺少执行上下文，无法读取详情。</div>
            ) : detailLoading ? (
                <div className="offline-execution-page-empty">正在读取执行详情...</div>
            ) : detailError ? (
                <div className="offline-execution-page-empty">{detailError}</div>
            ) : !detail ? (
                <div className="offline-execution-page-empty">未找到这条执行记录。</div>
            ) : (
                <>
                    <section className="offline-execution-summary-card">
                        <div className="offline-execution-summary-main">
                            <div className="offline-execution-status-line">
                                <strong className={`offline-execution-status-text is-${presentation.progressTone}`}>
                                    {getExecutionStatusLabel(detail.status)}
                                </strong>
                            </div>
                            <div className={`offline-execution-progress is-${presentation.progressTone}${presentation.animated ? ' is-animated' : ''}`}>
                                <span />
                            </div>
                        </div>
                        <div className="offline-execution-summary-grid">
                            <div>
                                <span>执行 ID</span>
                                <strong>{detail.executionId}</strong>
                            </div>
                            <div>
                                <span>所属分支</span>
                                <strong>{detail.branch ?? '—'}</strong>
                            </div>
                            <div>
                                <span>开始时间</span>
                                <strong>{formatDateTime(detail.startDate ?? detail.createdAt)}</strong>
                            </div>
                            <div>
                                <span>结束时间</span>
                                <strong>{formatDateTime(detail.endDate)}</strong>
                            </div>
                        </div>
                    </section>

                    <div className="offline-execution-content-layout">
                        <aside className="offline-execution-tasks-sidebar">
                            <div className="offline-tasks-header">
                                <LayoutList size={14} />
                                <span>节点状态</span>
                            </div>
                            <div className="offline-tasks-list">
                                <button
                                    type="button"
                                    className={`offline-task-item${selectedTaskId === null ? ' is-active' : ''}`}
                                    onClick={() => setSelectedTaskId(null)}
                                >
                                    <ListFilter size={14} />
                                    <span className="offline-task-name">全部日志</span>
                                </button>
                                {detail.taskRuns?.map((task) => {
                                    const StatusIcon = getTaskStatusIcon(task.status);
                                    const isRunning = isRunningStatus(task.status);
                                    return (
                                        <button
                                            key={task.taskId}
                                            type="button"
                                            className={`offline-task-item${selectedTaskId === task.taskId ? ' is-active' : ''}`}
                                            onClick={() => setSelectedTaskId(task.taskId)}
                                        >
                                            <StatusIcon 
                                                size={14} 
                                                className={`offline-task-icon is-${task.status.toLowerCase()}${isRunning ? ' is-animated' : ''}`} 
                                            />
                                            <span className="offline-task-name">{task.taskId}</span>
                                            <span className="offline-task-duration">{formatDuration(task.startDate, task.endDate)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </aside>

                        <section className="offline-execution-detail-card">
                            {logsLoading ? (
                                <div className="offline-execution-page-empty">正在读取执行日志...</div>
                            ) : logsError ? (
                                <div className="offline-execution-page-empty">{logsError}</div>
                            ) : logs.length === 0 ? (
                                <div className="offline-execution-page-empty">当前{selectedTaskId ? '节点' : '执行'}还没有日志。</div>
                            ) : (
                                <div className="offline-execution-log-surface">
                                    {logs.map((entry, index) => (
                                        <div key={`${entry.timestamp ?? 'log'}-${index}`} className="offline-execution-log-line">
                                            <span>{formatDateTime(entry.timestamp)}</span>
                                            <strong>{entry.level ?? 'INFO'}</strong>
                                            <em>{entry.taskId ?? 'flow'}</em>
                                            <p>{entry.message ?? ''}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                </>
            )}
        </div>
    );
}
