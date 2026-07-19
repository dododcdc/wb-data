import { useMemo, useState } from 'react';
import { Copy, LoaderCircle, RefreshCcw, TerminalSquare, X } from 'lucide-react';

import type {
    OfflineExecutionDetail,
    OfflineExecutionListItem,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from '../../components/ui/dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
    getExecutionPresentation,
    getExecutionStatusLabel,
    getTaskStatusIcon,
    isRunningStatus,
    isStoppable,
} from './executionPresentation';
import './OfflineExecutionDialog.css';

function formatDateTime(value: string | number | null | undefined) {
    if (!value) return '—';
    const date = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDuration(durationMs: number | null) {
    if (durationMs == null) return '—';
    if (durationMs < 1000) return `${durationMs}ms`;
    const seconds = durationMs / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1).replace(/\.0$/, '')}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
}

function isUserTaskRun(taskId: string) {
    return !taskId.startsWith('parallel_') && taskId !== 'flow_dag';
}

interface OfflineExecutionDialogProps {
    open: boolean;
    executions: OfflineExecutionListItem[];
    loading: boolean;
    detail: OfflineExecutionDetail | null;
    detailLoading: boolean;
    activeExecutionId: string | null;
    actionPending: string | null;
    requestedByFilter: number | null;
    currentUserId: number | null;
    onOpenChange: (open: boolean) => void;
    onRefresh: () => void;
    onSelectExecution: (executionId: string) => void;
    onStopAll: () => void;
    onOpenTaskLogs: (executionId: string, taskId: string) => void;
    onRequestedByFilterChange: (requestedBy: number | null) => void;
}

export function OfflineExecutionDialog({
    open,
    executions,
    loading,
    detail,
    detailLoading,
    activeExecutionId,
    actionPending,
    requestedByFilter,
    currentUserId,
    onOpenChange,
    onRefresh,
    onSelectExecution,
    onStopAll,
    onOpenTaskLogs,
    onRequestedByFilterChange,
}: OfflineExecutionDialogProps) {
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
    const requestedByOptions = currentUserId == null
        ? [{ label: '全部用户', value: 'ALL' }]
        : [
            { label: '全部用户', value: 'ALL' },
            { label: '仅我', value: 'ME' },
        ];
    const visibleTaskRuns = useMemo(
        () => detail?.taskRuns?.filter((task) => isUserTaskRun(task.taskId)) ?? [],
        [detail],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent ref={(el) => { setDialogEl(el); }} className="offline-execution-dialog" hideClose>
                <DialogTitle className="sr-only">执行结果</DialogTitle>
                <div className="dialog-toolbar offline-dialog-toolbar">
                    <div className="offline-execution-toolbar-left">
                        <label className="offline-execution-filter">
                            <span>用户</span>
                            <div className="offline-execution-filter-control">
                                <SimpleSelect
                                    options={requestedByOptions}
                                    value={requestedByFilter == null ? 'ALL' : 'ME'}
                                    menuPlacement="down"
                                    menuContainer={dialogEl}
                                    onChange={(value) => onRequestedByFilterChange(value === 'ME' ? currentUserId : null)}
                                />
                            </div>
                        </label>
                    </div>
                    <div className="offline-execution-toolbar-right">
                        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                            <RefreshCcw size={14} />
                            刷新
                        </Button>

                        {(executions.some((item) => isStoppable(item.status)) || actionPending === 'ALL') && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="offline-button-stop"
                                onClick={onStopAll}
                                disabled={actionPending === 'ALL'}
                            >
                                {actionPending === 'ALL' ? <LoaderCircle size={14} className="offline-spin" /> : <TerminalSquare size={14} />}
                                停止
                            </Button>
                        )}
                        <button
                            type="button"
                            aria-label="关闭"
                            data-slot="dialog-close"
                            className="dialog-close-button"
                            onClick={() => onOpenChange(false)}
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="offline-execution-layout">
                    <section className="offline-execution-list">
                        {loading ? (
                            <div className="offline-list-placeholder">正在加载执行记录...</div>
                        ) : executions.length === 0 ? (
                            <div className="offline-list-placeholder">当前 Flow 还没有执行记录。</div>
                        ) : (
                            executions.map((item) => {
                                const presentation = getExecutionPresentation(item.status);
                                return (
                                    <button
                                        key={item.executionId}
                                        type="button"
                                        className={`offline-execution-row is-${presentation.dotTone}${item.executionId === activeExecutionId ? ' is-active' : ''}`}
                                        onClick={() => onSelectExecution(item.executionId)}
                                    >
                                        <div className="offline-execution-row-main">
                                            <div className="offline-execution-row-title">
                                                <span className={`offline-execution-dot is-${presentation.dotTone}`} aria-hidden="true" />
                                                <strong>{item.displayName || `ID: ${item.executionId.slice(-8)}`}</strong>
                                            </div>
                                            <div className="offline-execution-row-meta">
                                                <span className="offline-execution-row-meta-item">
                                                    {formatDateTime(item.startDate)}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </section>

                    <section className="offline-execution-detail">
                        {detailLoading ? (
                            <div className="offline-list-placeholder">正在加载执行详情...</div>
                        ) : !detail ? (
                            <div className="offline-list-placeholder">选择一条执行记录查看概览。</div>
                        ) : (
                            <div className="offline-detail-body">
                                <div className="offline-detail-meta-minimal">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span>{formatDateTime(detail.startDate ?? detail.createdAt)}</span>
                                        </TooltipTrigger>
                                        <TooltipContent>开始时间</TooltipContent>
                                    </Tooltip>
                                    <span className="meta-sep">→</span>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span>{detail.endDate ? formatDateTime(detail.endDate) : '进行中'}</span>
                                        </TooltipTrigger>
                                        <TooltipContent>结束时间</TooltipContent>
                                    </Tooltip>
                                    <span className="meta-divider">|</span>
                                    <span className="offline-branch-badge-tiny">{detail.branch ?? '—'}</span>
                                    <span className="meta-divider">|</span>
                                    <code className="meta-id-tiny">{detail.executionId}</code>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-4 w-4 p-0 ml-1 opacity-50 hover:opacity-100"
                                        onClick={() => navigator.clipboard.writeText(detail.executionId)}
                                    >
                                        <Copy size={10} />
                                    </Button>
                                </div>

                                {visibleTaskRuns.length > 0 && (
                                    <div className="offline-detail-tasks">
                                        <div className="offline-detail-tasks-header">
                                            <span>节点执行详情</span>
                                            <em>{visibleTaskRuns.length} 个节点</em>
                                        </div>
                                        <div className="offline-detail-tasks-list">
                                            <div className="offline-tasks-list-thead">
                                                <div className="col-node">节点</div>
                                                <div className="col-time">开始时间</div>
                                                <div className="col-time">结束时间</div>
                                                <div className="col-duration">耗时</div>
                                                <div className="col-progress">进度</div>
                                                <div className="col-status">状态</div>
                                                <div className="col-actions"></div>
                                            </div>
                                            <div className="offline-tasks-list-tbody">
                                                {visibleTaskRuns.map((task) => {
                                                    const StatusIcon = getTaskStatusIcon(task.status);
                                                    const isRunning = isRunningStatus(task.status);
                                                    const duration = task.startDate && task.endDate
                                                        ? new Date(task.endDate).getTime() - new Date(task.startDate).getTime()
                                                        : task.startDate && isRunning
                                                            ? Date.now() - new Date(task.startDate).getTime()
                                                            : null;

                                                    return (
                                                        <div key={task.taskId} className="offline-tasks-list-row">
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className="col-node">
                                                                        <strong>{task.taskId}</strong>
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent>{task.taskId}</TooltipContent>
                                                            </Tooltip>
                                                            <div className="col-time">
                                                                {task.startDate ? formatDateTime(task.startDate).split(' ')[1] : '—'}
                                                            </div>
                                                            <div className="col-time">
                                                                {task.endDate ? formatDateTime(task.endDate).split(' ')[1] : '—'}
                                                            </div>
                                                            <div className="col-duration">
                                                                {formatDuration(duration)}
                                                            </div>
                                                            <div className="col-progress">
                                                                <div className="task-progress-mini">
                                                                    {task.status === 'SUCCESS' ? (
                                                                        <span className="progress-value is-done">100%</span>
                                                                    ) : isRunning ? (
                                                                        <div className="progress-bar-tiny">
                                                                            <div className="progress-bar-inner is-running" />
                                                                        </div>
                                                                    ) : (
                                                                        <span className="progress-value">0%</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="col-status">
                                                                <div className={`offline-status-badge is-${task.status.toLowerCase()}`}>
                                                                    <StatusIcon
                                                                        size={12}
                                                                        className={`offline-task-icon${isRunning ? ' is-animated' : ''}`}
                                                                    />
                                                                    <span>{getExecutionStatusLabel(task.status)}</span>
                                                                </div>
                                                            </div>
                                                            <div className="col-actions">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    style={{ height: '24px', padding: '0 8px', fontSize: '0.72rem' }}
                                                                    onClick={() => onOpenTaskLogs(detail.executionId, task.taskId)}
                                                                >
                                                                    日志
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}
