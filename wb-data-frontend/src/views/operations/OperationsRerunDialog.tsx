import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';

import {
    getOperationsExecution,
    type OperationsExecutionDetail,
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

interface OperationsRerunDialogProps {
    open: boolean;
    groupId: number;
    executionId: string | null;
    detail?: OperationsExecutionDetail | null;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (reuseManualOverrides: boolean) => void;
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
    const detailQuery = useQuery({
        queryKey: ['operations-execution', groupId, executionId],
        queryFn: () => getOperationsExecution(groupId, executionId ?? ''),
        enabled: open && Boolean(executionId) && !detail,
    });
    const resolvedDetail = detail ?? detailQuery.data ?? null;
    const manualOverrides = useMemo(
        () => resolvedDetail?.parameters.filter((parameter) => parameter.source === 'MANUAL_OVERRIDE') ?? [],
        [resolvedDetail],
    );
    const snapshotUnavailable = resolvedDetail?.parameterResolutionStatus === 'UNAVAILABLE';
    const snapshotChanged = resolvedDetail?.parameterSnapshotChanged === true;

    useEffect(() => {
        setReuseManualOverrides(false);
    }, [executionId, open]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (!pending) onOpenChange(nextOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent style={{ maxWidth: '560px' }} hideClose={pending}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <RotateCcw size={18} />
                        确认重跑任务
                    </DialogTitle>
                    <DialogDescription>
                        将创建一条新的执行记录，原执行不会被修改。
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 px-6 py-4">
                    {detailQuery.isLoading && !resolvedDetail ? (
                        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                            <LoaderCircle className="animate-spin" size={16} />
                            正在读取原执行参数...
                        </div>
                    ) : detailQuery.isError && !resolvedDetail ? (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                            原执行详情读取失败，暂时不能安全重跑。
                        </div>
                    ) : resolvedDetail ? (
                        <>
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

                <DialogFooter>
                    <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
                        取消
                    </Button>
                    <Button
                        type="button"
                        disabled={pending || !resolvedDetail}
                        onClick={() => onConfirm(reuseManualOverrides)}
                    >
                        {pending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
                        {pending ? '正在重跑...' : '确认重跑'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
