import { useEffect, useRef, useState } from 'react';
import { getOfflineDependents, type OfflineDependentItem } from '../../api/offline';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import { getErrorMessage } from '../../utils/error';

export interface DeleteFlowDependencyDialogProps {
    groupId: number;
    path: string;
    name: string;
    pending: boolean;
    error?: string;
    onOpenChange: (open: boolean) => void;
    onSubmit: () => void;
}

export function DeleteFlowDependencyDialog(props: DeleteFlowDependencyDialogProps) {
    // Mount only for an open delete action. Switching targets must immediately
    // invalidate the previous permission to submit, before the next effect.
    return <DeleteFlowDependencyCheck key={JSON.stringify([props.groupId, props.path])} {...props} />;
}

function DeleteFlowDependencyCheck({
    groupId,
    path,
    name,
    pending,
    error,
    onOpenChange,
    onSubmit,
}: DeleteFlowDependencyDialogProps) {
    const [dependents, setDependents] = useState<OfflineDependentItem[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const loading = dependents === null && loadError === null;
    const canDelete = dependents?.length === 0 && !pending;

    useEffect(() => {
        let active = true;
        getOfflineDependents(groupId, path).then(
            (items) => { if (active) setDependents(items); },
            (reason: unknown) => {
                if (active) setLoadError(getErrorMessage(reason, '请检查网络后重试'));
            },
        );
        return () => { active = false; };
    }, [groupId, path, attempt]);

    const retry = () => {
        setDependents(null);
        setLoadError(null);
        setAttempt((value) => value + 1);
    };
    const changeOpen = (open: boolean) => {
        if (!pending) onOpenChange(open);
    };

    return (
        <Dialog open onOpenChange={changeOpen}>
            <DialogContent
                hideClose={pending}
                style={{ maxWidth: 480, maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', minWidth: 0, overflowY: 'auto' }}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    cancelRef.current?.focus();
                }}
            >
                <DialogHeader className="min-w-0 shrink-0">
                    <DialogTitle>确认删除任务</DialogTitle>
                    <DialogDescription className="[overflow-wrap:anywhere]">
                        确定要删除任务「{name}」吗？此操作不可恢复。
                    </DialogDescription>
                </DialogHeader>
                <div className="dialog-body min-w-0 space-y-3 overflow-y-auto text-sm leading-relaxed [overflow-wrap:anywhere]" style={{ minHeight: 96 }}>
                    <section aria-label="删除依赖检查" aria-busy={loading} className="space-y-2 text-muted-foreground">
                        {loading ? (
                            <div aria-hidden="true" className="space-y-2 py-1">
                                <div className="h-3 w-3/4 rounded bg-muted" />
                                <div className="h-3 w-1/2 rounded bg-muted" />
                            </div>
                        ) : loadError ? (
                            <>
                                <p role="alert">下游依赖读取失败：{loadError}。请重试，确认无下游依赖后才能删除。</p>
                                <Button type="button" variant="outline" disabled={pending} onClick={retry}>重试</Button>
                            </>
                        ) : dependents && dependents.length > 0 ? (
                            <>
                                <p>以下 {dependents.length} 个下游任务依赖本任务。请先在下游任务中解除依赖，再删除本任务。</p>
                                <ul
                                    aria-label="下游任务"
                                    tabIndex={0}
                                    className="space-y-2 overflow-y-auto overscroll-contain rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                                    style={{ maxHeight: 192 }}
                                >
                                    {dependents.map((item) => (
                                        <li key={JSON.stringify([item.groupId, item.flowId, item.path])}>
                                            <span className="text-foreground">{item.groupName || `项目组 ${item.groupId}`} / {item.flowId}</span>
                                            <span className="block text-xs">{item.path}</span>
                                        </li>
                                    ))}
                                </ul>
                                <Button type="button" variant="outline" disabled={pending} onClick={retry}>重新检查</Button>
                            </>
                        ) : <p>未发现下游依赖。删除时服务器仍会复核依赖关系。</p>}
                    </section>
                    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                </div>
                <DialogFooter className="shrink-0 flex-wrap">
                    <Button ref={cancelRef} type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>取消</Button>
                    <Button type="button" variant="destructive" disabled={!canDelete} onClick={() => { if (canDelete) onSubmit(); }}>
                        {pending ? '删除中…' : '删除'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
