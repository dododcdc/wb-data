import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Info, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';

import {
    getOperationsExecution,
    getOperationsExecutionRerunContext,
    type OperationsExecutionDetail,
    type OperationsExecutionRerunRequest,
} from '../../api/operations';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import { formatBrowserDateTime } from '../../lib/dateTime';
import { OperationsRerunCanvas } from './OperationsRerunCanvas';
import './OperationsRerunDialog.css';
import { toggleRerunNodeSelection } from './rerunSelection';

interface OperationsRerunDialogProps {
    open: boolean;
    groupId: number;
    executionId: string | null;
    detail?: OperationsExecutionDetail | null;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (payload: OperationsExecutionRerunRequest) => void;
}

export function OperationsRerunDialog({
    open,
    groupId,
    executionId,
    detail,
    pending,
    onOpenChange,
    onConfirm,
}: OperationsRerunDialogProps) {
    const [reuseManualOverrides, setReuseManualOverrides] = useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
    const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

    const detailQuery = useQuery({
        queryKey: ['operations-execution', groupId, executionId],
        queryFn: () => getOperationsExecution(groupId, executionId ?? ''),
        enabled: open && Boolean(executionId) && !detail,
    });
    const rerunContextQuery = useQuery({
        queryKey: ['operations-execution-rerun-context', groupId, executionId],
        queryFn: () => getOperationsExecutionRerunContext(groupId, executionId ?? ''),
        enabled: open && Boolean(executionId),
    });

    const resolvedDetail = detail ?? detailQuery.data ?? null;
    const rerunContext = rerunContextQuery.data ?? null;
    const manualOverrides = useMemo(
        () => resolvedDetail?.parameters.filter((parameter) => parameter.source === 'MANUAL_OVERRIDE') ?? [],
        [resolvedDetail],
    );
    const snapshotUnavailable = resolvedDetail?.parameterResolutionStatus === 'UNAVAILABLE';
    const snapshotChanged = resolvedDetail?.parameterSnapshotChanged === true;

    const requiredTaskIdSet = useMemo(
        () => new Set(rerunContext?.requiredTaskIds ?? []),
        [rerunContext],
    );
    const orderedNodeIds = useMemo(
        () => rerunContext?.nodes.map((node) => node.taskId) ?? [],
        [rerunContext],
    );

    useEffect(() => {
        setReuseManualOverrides(false);
        setFeedbackMessage(null);
    }, [executionId, open]);

    useEffect(() => {
        if (!open) {
            setSelectedTaskIds(new Set());
            return;
        }
        if (rerunContext) {
            setSelectedTaskIds(new Set(rerunContext.defaultSelectedTaskIds));
            setFeedbackMessage(null);
        }
    }, [open, rerunContext]);

    const handleToggleNode = useCallback((taskId: string) => {
        if (!rerunContext || !rerunContext.partialRerunSupported) {
            setFeedbackMessage('当前线上版本暂不支持按节点取消勾选，请确认后重跑整个任务。');
            return;
        }
        setSelectedTaskIds((prev) => {
            const result = toggleRerunNodeSelection(
                prev,
                taskId,
                rerunContext.edges,
                requiredTaskIdSet,
                orderedNodeIds,
            );
            if (result.blockedReason === 'required') {
                setFeedbackMessage(`节点「${taskId}」为失败/未执行节点或其下游，必须包含在本次重跑中。`);
                return prev;
            }
            if (result.autoAdded.length > 0) {
                setFeedbackMessage(`为避免数据断层，已自动联动勾选路径节点：${result.autoAdded.join('、')}`);
            } else if (result.autoRemoved.length > 0) {
                setFeedbackMessage(`为避免数据断层，已同步取消上游节点：${result.autoRemoved.join('、')}`);
            } else {
                setFeedbackMessage(null);
            }
            return result.nextSelected;
        });
    }, [orderedNodeIds, requiredTaskIdSet, rerunContext]);

    const handleSelectAll = useCallback(() => {
        if (!rerunContext) return;
        setSelectedTaskIds(new Set(rerunContext.nodes.map((node) => node.taskId)));
        setFeedbackMessage(null);
    }, [rerunContext]);

    const handleResetDefault = useCallback(() => {
        if (!rerunContext) return;
        setSelectedTaskIds(new Set(rerunContext.defaultSelectedTaskIds));
        setFeedbackMessage(null);
    }, [rerunContext]);

    const orderedSelected = useMemo(() => {
        if (!rerunContext) return [];
        return rerunContext.nodes
            .map((node) => node.taskId)
            .filter((taskId) => selectedTaskIds.has(taskId));
    }, [rerunContext, selectedTaskIds]);

    const totalNodes = rerunContext?.nodes.length ?? 0;
    const isPartialRerun = Boolean(
        rerunContext?.partialRerunSupported && orderedSelected.length > 0 && orderedSelected.length < totalNodes,
    );
    const hasNodes = totalNodes > 0;
    const isLoadingInitial = (detailQuery.isLoading && !resolvedDetail)
        || (rerunContextQuery.isLoading && !rerunContext);
    const hasFatalError = (detailQuery.isError && !resolvedDetail)
        || (rerunContextQuery.isError && !rerunContext);

    const handleConfirmClick = () => {
        if (isPartialRerun) {
            onConfirm({
                reuseManualOverrides,
                selectedTaskIds: orderedSelected,
            });
            return;
        }
        onConfirm({ reuseManualOverrides });
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!pending) onOpenChange(nextOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className={hasNodes ? 'operations-rerun-dialog' : 'operations-rerun-dialog operations-rerun-dialog--compact'}
                hideClose={pending}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <RotateCcw size={18} />
                        确认重跑任务
                    </DialogTitle>
                    <DialogDescription>
                        将创建一条新的执行记录，原执行不会被修改；可按需勾选上游已成功节点一并重跑。
                    </DialogDescription>
                </DialogHeader>

                <div className="operations-rerun-dialog__body space-y-4">
                    {isLoadingInitial ? (
                        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                            <LoaderCircle className="animate-spin" size={16} />
                            正在读取原执行参数与任务画布...
                        </div>
                    ) : hasFatalError ? (
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                            <span>
                                {rerunContextQuery.isError && !rerunContext
                                    ? '任务画布与节点状态读取失败，暂时不能重跑。'
                                    : '原执行详情读取失败，暂时不能安全重跑。'}
                            </span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    if (detailQuery.isError) void detailQuery.refetch();
                                    if (rerunContextQuery.isError) void rerunContextQuery.refetch();
                                }}
                            >
                                重试
                            </Button>
                        </div>
                    ) : resolvedDetail && rerunContext ? (
                        <>
                            {rerunContext.fallbackReason ? (
                                <div
                                    className={rerunContext.graphChanged
                                        ? 'flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-700'
                                        : 'flex gap-2 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground'}
                                    role={rerunContext.graphChanged ? 'alert' : 'status'}
                                >
                                    {rerunContext.graphChanged ? (
                                        <TriangleAlert className="mt-0.5 shrink-0" size={15} />
                                    ) : (
                                        <Info className="mt-0.5 shrink-0" size={15} />
                                    )}
                                    <span>{rerunContext.fallbackReason}</span>
                                </div>
                            ) : null}

                            {hasNodes ? (
                                <OperationsRerunCanvas
                                    nodes={rerunContext.nodes}
                                    edges={rerunContext.edges}
                                    selectedTaskIds={selectedTaskIds}
                                    requiredTaskIds={requiredTaskIdSet}
                                    partialRerunSupported={rerunContext.partialRerunSupported}
                                    disabled={pending}
                                    feedbackMessage={feedbackMessage}
                                    onToggleNode={handleToggleNode}
                                    onSelectAll={handleSelectAll}
                                    onResetDefault={handleResetDefault}
                                />
                            ) : (
                                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                                    当前任务暂无编排节点，将直接重跑整条任务。
                                </div>
                            )}

                            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                                <div>
                                    <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <CalendarClock size={13} />
                                        沿用原计划时间
                                    </div>
                                    <div className="text-sm font-medium">
                                        {formatBrowserDateTime(resolvedDetail.plannedAt)}
                                    </div>
                                </div>
                                <div>
                                    <div className="mb-1 text-xs text-muted-foreground">本次执行开始时间</div>
                                    <div className="text-sm font-medium">新执行启动时重新取得</div>
                                </div>
                            </div>

                            {manualOverrides.length > 0 ? (
                                <div className="space-y-2.5">
                                    <div>
                                        <div className="text-sm font-medium">原执行的手动覆盖</div>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            默认不沿用。勾选后，以下覆盖值会传给新执行。
                                        </p>
                                    </div>
                                    <div className="max-h-36 overflow-y-auto rounded-lg border divide-y">
                                        {manualOverrides.map((parameter) => (
                                            <div key={parameter.key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 px-3 py-2 text-xs">
                                                <code className="truncate font-semibold" title={parameter.key}>{parameter.key}</code>
                                                <code className="break-all text-muted-foreground">{parameter.value ?? ''}</code>
                                            </div>
                                        ))}
                                    </div>
                                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/30">
                                        <input
                                            type="checkbox"
                                            aria-label="沿用原执行的手动覆盖值"
                                            className="mt-0.5 size-4 shrink-0 accent-primary"
                                            checked={reuseManualOverrides}
                                            disabled={pending}
                                            onChange={(event) => setReuseManualOverrides(event.target.checked)}
                                        />
                                        <span>
                                            <span className="block font-medium">沿用原执行的手动覆盖值</span>
                                            <span className="mt-0.5 block text-xs text-muted-foreground">不勾选时，新执行按参数快照重新解析。</span>
                                        </span>
                                    </label>
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">原执行没有手动覆盖值，新执行将按参数快照重新解析。</p>
                            )}

                            {snapshotChanged ? (
                                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700" role="alert">
                                    <TriangleAlert className="mt-0.5 shrink-0" size={16} />
                                    原执行之后任务的参数已更新，重跑将使用当前参数值（计划时间仍沿用原执行）。
                                </div>
                            ) : null}
                            {snapshotUnavailable ? (
                                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700" role="alert">
                                    <TriangleAlert className="mt-0.5 shrink-0" size={16} />
                                    原执行的参数快照不可用，无法展示当时的参数值；重跑将按当前任务参数执行。
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </div>

                <DialogFooter className="operations-rerun-dialog__footer">
                    {isPartialRerun ? (
                        <span className="operations-rerun-dialog__footer-summary">
                            将执行 {orderedSelected.length} 个节点，跳过 {totalNodes - orderedSelected.length} 个节点
                        </span>
                    ) : null}
                    <div className="operations-rerun-dialog__footer-actions">
                        <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
                            取消
                        </Button>
                        <Button
                            type="button"
                            disabled={pending || !resolvedDetail || !rerunContext || (hasNodes && orderedSelected.length === 0)}
                            onClick={handleConfirmClick}
                        >
                            {pending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
                            {pending ? '正在重跑...' : '确认重跑'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
