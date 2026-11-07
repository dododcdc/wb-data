import { useEffect, useMemo, useState } from 'react';
import { Copy, History, LoaderCircle, RefreshCcw, ScrollText, TerminalSquare, X } from 'lucide-react';

import type {
    OfflineExecutionDetail,
    OfflineExecutionListItem,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import { ListShell } from '../../components/ui/list/ListShell';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from '../../components/ui/dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import {
    getExecutionPresentation,
    getExecutionStatusLabel,
    isRunningStatus,
    isStoppable,
    isUserTaskId,
} from '../../components/execution/executionPresentation';
import { ExecutionTaskLogPanel } from './ExecutionTaskLogPanel';
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
    onRequestedByFilterChange: (requestedBy: number | null) => void;
}

interface OfflineExecutionListProps {
    executions: OfflineExecutionListItem[];
    listBusy: boolean;
    activeExecutionId: string | null;
    onSelectExecution: (executionId: string) => void;
}

export function OfflineExecutionList({
    executions,
    listBusy,
    activeExecutionId,
    onSelectExecution,
}: OfflineExecutionListProps) {
    return (
        <ListShell
            state={listBusy && executions.length === 0 ? 'loading' : 'ready'}
            isRefreshing={listBusy && executions.length > 0}
            className="offline-execution-list-shell"
        >
            {listBusy && executions.length === 0 ? (
                <div className="offline-execution-skeleton" role="status">
                    <span className="sr-only">正在加载执行记录</span>
                    {Array.from({ length: 4 }).map((_, index) => (
                        <div className="offline-execution-skeleton-row" key={index} aria-hidden="true">
                            <span className="skeleton-line offline-execution-skeleton-dot" />
                            <span className="skeleton-line offline-execution-skeleton-title" />
                        </div>
                    ))}
                </div>
            ) : executions.map((item) => {
                const presentation = getExecutionPresentation(item.status);
                return (
                    <button
                        key={item.executionId}
                        type="button"
                        className={`offline-execution-row is-${presentation.dotTone}${item.executionId === activeExecutionId ? ' is-active' : ''}`}
                        aria-pressed={item.executionId === activeExecutionId}
                        onClick={() => onSelectExecution(item.executionId)}
                    >
                        <div className="offline-execution-row-main">
                            <div className="offline-execution-row-title">
                                <span className={`offline-execution-dot is-${presentation.dotTone}`} aria-hidden="true" />
                                <strong>{item.displayName || `ID: ${item.executionId.slice(-8)}`}</strong>
                            </div>
                            <div className="offline-execution-row-meta">
                                <span className={`offline-execution-row-status is-${presentation.dotTone}`}>
                                    {getExecutionStatusLabel(item.status)}
                                </span>
                                <span className="offline-execution-row-meta-item">
                                    {formatDateTime(item.startDate)}
                                </span>
                            </div>
                        </div>
                    </button>
                );
            })}
        </ListShell>
    );
}

interface OfflineExecutionParametersProps {
    parameters: OfflineExecutionDetail['parameters'];
}

export function OfflineExecutionParameters({ parameters }: OfflineExecutionParametersProps) {
    const columns: DataListColumn<OfflineExecutionDetail['parameters'][number]>[] = [
        {
            key: 'key',
            header: '参数',
            primary: true,
            mono: true,
            width: '30%',
            cell: (param) => <span className="offline-param-key">:{param.key}</span>,
        },
        {
            key: 'value',
            header: '值',
            truncate: true,
            width: '45%',
            cell: (param) => {
                const value = param.value === null ? '—' : param.value === '' ? '""' : param.value;
                return <span className="offline-param-val" title={param.value ?? '""'}>{value}</span>;
            },
        },
        {
            key: 'source',
            header: '来源',
            width: '25%',
            cell: (param) => (
                <StatusPill
                    tone={param.source === 'MANUAL_OVERRIDE' ? 'warning' : param.source === 'SYSTEM_TIME' ? 'info' : 'neutral'}
                    dot={false}
                >
                    {param.source === 'MANUAL_OVERRIDE' ? '手动覆盖' : param.source === 'SYSTEM_TIME' ? '时间' : '固定值'}
                </StatusPill>
            ),
        },
    ];

    return (
        <DataList
            rows={parameters}
            columns={columns}
            rowKey={(param) => param.key}
            ariaLabel="执行参数快照"
            minWidth="420px"
            className="wb-offline-params-grid wb-list-compact"
        />
    );
}

interface OfflineExecutionTaskTableProps {
    tasks: OfflineExecutionDetail['taskRuns'];
    onOpenLogs: (taskId: string) => void;
}

export function OfflineExecutionTaskTable({ tasks, onOpenLogs }: OfflineExecutionTaskTableProps) {
    const columns: DataListColumn<OfflineExecutionDetail['taskRuns'][number]>[] = [
        {
            key: 'node',
            header: '节点',
            primary: true,
            width: '22%',
            cell: (task) => (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <strong>{task.taskId}</strong>
                    </TooltipTrigger>
                    <TooltipContent>{task.taskId}</TooltipContent>
                </Tooltip>
            ),
        },
        {
            key: 'start',
            header: '开始时间',
            mono: true,
            width: 110,
            cell: (task) => task.startDate ? formatDateTime(task.startDate).split(' ')[1] : '—',
        },
        {
            key: 'end',
            header: '结束时间',
            mono: true,
            width: 110,
            cell: (task) => task.endDate ? formatDateTime(task.endDate).split(' ')[1] : '—',
        },
        {
            key: 'duration',
            header: '耗时',
            mono: true,
            align: 'right',
            width: 90,
            cell: (task) => {
                const running = isRunningStatus(task.status);
                const duration = task.startDate && task.endDate
                    ? new Date(task.endDate).getTime() - new Date(task.startDate).getTime()
                    : task.startDate && running
                        ? Date.now() - new Date(task.startDate).getTime()
                        : null;
                return formatDuration(duration);
            },
        },
        {
            key: 'progress',
            header: '进度',
            width: 100,
            cell: (task) => (
                <div className="task-progress-mini">
                    {task.status === 'SUCCESS'
                        ? <span className="progress-value is-done">100%</span>
                        : isRunningStatus(task.status)
                            ? <div className="progress-bar-tiny"><div className="progress-bar-inner is-running" /></div>
                            : <span className="progress-value">0%</span>}
                </div>
            ),
        },
        {
            key: 'status',
            header: '状态',
            width: 110,
            cell: (task) => {
                const tone = getExecutionPresentation(task.status).dotTone;
                return (
                    <StatusPill tone={tone === 'success' ? 'success' : tone === 'failed' ? 'danger' : tone === 'running' ? 'info' : 'neutral'}>
                        {getExecutionStatusLabel(task.status)}
                    </StatusPill>
                );
            },
        },
        {
            key: 'actions',
            header: '操作',
            align: 'right',
            width: 70,
            cell: (task) => {
                const actions: RowActionItem[] = [
                    { key: 'logs', label: '日志', icon: ScrollText, onClick: () => onOpenLogs(task.taskId) },
                ];
                return <RowActions items={actions} maxVisible={1} />;
            },
        },
    ];

    return (
        <DataList
            rows={tasks}
            columns={columns}
            rowKey={(task) => task.taskId}
            ariaLabel="节点执行表"
            minWidth="920px"
            className="wb-offline-task-grid wb-list-compact"
        />
    );
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
    onRequestedByFilterChange,
}: OfflineExecutionDialogProps) {
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
    const [logTaskId, setLogTaskId] = useState<string | null>(null);
    const listBusy = useDelayedBusy(loading);
    const detailBusy = useDelayedBusy(detailLoading);
    const requestedByOptions = currentUserId == null
        ? [{ label: '全部用户', value: 'ALL' }]
        : [
            { label: '全部用户', value: 'ALL' },
            { label: '仅我', value: 'ME' },
        ];
    const visibleTaskRuns = useMemo(
        () => detail?.taskRuns?.filter((task) => isUserTaskId(task.taskId)) ?? [],
        [detail],
    );

    useEffect(() => {
        if (!open) setLogTaskId(null);
    }, [open]);

    useEffect(() => {
        setLogTaskId(null);
    }, [activeExecutionId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent ref={(el) => { setDialogEl(el); }} className="offline-execution-dialog" hideClose aria-describedby={undefined}>
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

                {!loading && !listBusy && executions.length === 0 ? (
                    <ListShell
                        state="empty"
                        className="offline-execution-empty-shell"
                        emptyIcon={<History size={36} strokeWidth={1.2} aria-hidden="true" />}
                        emptyTitle="还没有执行记录"
                        emptyDescription="点击画布工具栏的「执行」运行当前任务"
                    />
                ) : (
                <div className="offline-execution-layout">
                    <section className="offline-execution-list">
                        <OfflineExecutionList
                            executions={executions}
                            listBusy={listBusy}
                            activeExecutionId={activeExecutionId}
                            onSelectExecution={(executionId) => {
                                setLogTaskId(null);
                                onSelectExecution(executionId);
                            }}
                        />
                    </section>

                    <section className="offline-execution-detail">
                        {logTaskId && detail ? (
                            <ExecutionTaskLogPanel
                                executionId={detail.executionId}
                                taskId={logTaskId}
                                running={isRunningStatus(detail.status)}
                                onBack={() => setLogTaskId(null)}
                            />
                        ) : detailBusy ? (
                            <div className="offline-execution-detail-skeleton" role="status">
                                <span className="sr-only">正在加载执行详情</span>
                                <span className="skeleton-line offline-execution-detail-skeleton-title" aria-hidden="true" />
                                <span className="skeleton-line offline-execution-detail-skeleton-line" aria-hidden="true" />
                                <span className="skeleton-line offline-execution-detail-skeleton-line is-short" aria-hidden="true" />
                                <span className="skeleton-line offline-execution-detail-skeleton-block" aria-hidden="true" />
                            </div>
                        ) : detailLoading && !detail ? (
                            <div className="offline-list-placeholder" aria-hidden="true" />
                        ) : !detail ? (
                            <div className="offline-list-placeholder offline-list-placeholder-centered">选择左侧记录查看详情</div>
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

                                {detail.parameters && detail.parameters.length > 0 && (
                                    <div className="offline-detail-params-section">
                                        <div className="offline-detail-tasks-header">
                                            <span>执行参数</span>
                                            <em>{detail.parameters.length} 个参数</em>
                                        </div>
                                        <OfflineExecutionParameters parameters={detail.parameters} />
                                    </div>
                                )}

                                {visibleTaskRuns.length > 0 && (
                                    <div className="offline-detail-tasks">
                                        <div className="offline-detail-tasks-header">
                                            <span>节点执行详情</span>
                                            <em>{visibleTaskRuns.length} 个节点</em>
                                        </div>
                                        <OfflineExecutionTaskTable tasks={visibleTaskRuns} onOpenLogs={setLogTaskId} />
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
