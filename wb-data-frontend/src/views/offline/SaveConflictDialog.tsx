import { useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';

interface SaveConflictDialogProps {
    open: boolean;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onOverwrite: () => void;
    onDiscardAndReload: () => void;
}

export function SaveConflictDialog(props: SaveConflictDialogProps) {
    const { open, pending, onOpenChange, onOverwrite, onDiscardAndReload } = props;
    const [confirmOverwrite, setConfirmOverwrite] = useState(false);

    useEffect(() => {
        if (!open) {
            setConfirmOverwrite(false);
        }
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent style={{ maxWidth: '480px' }} hideClose>
                <div className="dialog-toolbar">
                    <DialogHeader className="flex-1" style={{ padding: 0, borderBottom: 'none' }}>
                        <DialogTitle>保存冲突</DialogTitle>
                        <DialogDescription>
                            服务器版本已更新。请选择覆盖保存、加载最新内容，或稍后处理。
                        </DialogDescription>
                    </DialogHeader>
                    <button
                        type="button"
                        data-slot="dialog-close"
                        className="dialog-close-button"
                        aria-label="关闭"
                        onClick={() => onOpenChange(false)}
                        disabled={pending}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="dialog-body" style={{ display: 'grid', gap: 12 }}>
                    <div className="offline-conflict-copy">
                        <AlertTriangle size={16} />
                        <div>
                            <strong>当前保存的依据版本已经变化</strong>
                            <p>你的本地草稿仍然保留，只有明确选择后才会覆盖或丢弃。</p>
                        </div>
                    </div>

                    {confirmOverwrite ? (
                        <div style={{ display: 'grid', gap: 8 }}>
                            <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
                                覆盖保存会以你当前草稿为准，直接写回最新服务器版本。
                            </p>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setConfirmOverwrite(false)}
                                    disabled={pending}
                                >
                                    返回
                                </Button>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={onOverwrite}
                                    disabled={pending}
                                >
                                    {pending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                    {pending ? '覆盖中…' : '确认覆盖保存'}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: 8 }}>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => setConfirmOverwrite(true)}
                                disabled={pending}
                            >
                                用我的覆盖
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onDiscardAndReload}
                                disabled={pending}
                            >
                                丢弃本地并加载服务器
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                disabled={pending}
                            >
                                稍后处理
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
