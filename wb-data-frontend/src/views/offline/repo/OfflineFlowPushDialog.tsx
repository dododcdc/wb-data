import { AlertTriangle, ArrowUpRight, LoaderCircle, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../../components/ui/dialog';

interface OfflineFlowPushDialogProps {
    open: boolean;
    flowLabel: string;
    branchLabel: string;
    hasUncommittedChanges: boolean;
    pushing: boolean;
    onClose: () => void;
    onConfirmPush: () => void;
}

export function OfflineFlowPushDialog({
    open,
    flowLabel,
    branchLabel,
    hasUncommittedChanges,
    pushing,
    onClose,
    onConfirmPush,
}: OfflineFlowPushDialogProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && !pushing) {
                    onClose();
                }
            }}
        >
            <DialogContent style={{ maxWidth: '460px' }} hideClose>
                <div className="dialog-toolbar">
                    <DialogHeader className="flex-1" style={{ padding: 0, borderBottom: 'none' }}>
                        <DialogTitle className="flex items-center gap-2">
                            <ArrowUpRight size={16} aria-hidden="true" />
                            <span>推送当前任务</span>
                        </DialogTitle>
                        <DialogDescription>
                            仅将当前任务「{flowLabel}」在分支「{branchLabel}」上已提交的改动推送到远程仓库，不会带入其他任务尚未推送的提交。
                        </DialogDescription>
                    </DialogHeader>
                    <button
                        type="button"
                        data-slot="dialog-close"
                        className="dialog-close-button"
                        aria-label="关闭"
                        onClick={onClose}
                        disabled={pushing}
                    >
                        <X size={16} />
                    </button>
                </div>

                {hasUncommittedChanges ? (
                    <div className="dialog-body">
                        <div className="offline-conflict-copy" role="alert">
                            <AlertTriangle size={16} />
                            <div>
                                <strong>当前任务仍有未提交的工作区修改</strong>
                                <p>本次推送仅发送已提交的历史版本，不会发送未提交改动；如需一起提交，请在“提交当前任务”中使用“提交并推送”。</p>
                            </div>
                        </div>
                    </div>
                ) : null}

                <DialogFooter className="dialog-footer">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onClose}
                        disabled={pushing}
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={onConfirmPush}
                        disabled={pushing}
                    >
                        {pushing ? <LoaderCircle size={14} className="offline-spin" aria-hidden="true" /> : null}
                        <span>{pushing ? '推送中…' : '确认推送'}</span>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
