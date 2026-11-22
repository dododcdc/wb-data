import { AlertTriangle, GitCompare, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../../components/ui/dialog';
import type { VersionSelection } from './OfflineVersionCompareDialog';
import { formatRevisionTag } from './versionComparePresentation';

interface OfflineRollbackConfirmDialogProps {
    rollbackTarget: VersionSelection | null;
    rollingBack: boolean;
    savingFlow: boolean;
    dirtyWarningVisible: boolean;
    onClose: () => void;
    onCompareWithWorktree: () => void;
    onConfirmRollback: () => void;
}

export function OfflineRollbackConfirmDialog({
    rollbackTarget,
    rollingBack,
    savingFlow,
    dirtyWarningVisible,
    onClose,
    onCompareWithWorktree,
    onConfirmRollback,
}: OfflineRollbackConfirmDialogProps) {
    return (
        <Dialog
            open={rollbackTarget !== null}
            onOpenChange={(open) => {
                if (!open && !rollingBack) {
                    onClose();
                }
            }}
        >
            <DialogContent style={{ maxWidth: '520px' }} hideClose>
                <div className="dialog-toolbar">
                    <DialogHeader className="flex-1" style={{ padding: 0, borderBottom: 'none' }}>
                        <DialogTitle className="flex items-center gap-2">
                            <RotateCcw size={16} aria-hidden="true" />
                            <span>
                                确认回滚到版本 {rollbackTarget ? (rollbackTarget.shortRevision?.trim() || formatRevisionTag(rollbackTarget.revision)) : ''}
                            </span>
                        </DialogTitle>
                        <DialogDescription>
                            此操作仅覆盖当前任务工作区草稿（WORKTREE），不会自动提交或推送，也不会影响线上调度中的版本。
                        </DialogDescription>
                    </DialogHeader>
                    <button
                        type="button"
                        data-slot="dialog-close"
                        className="dialog-close-button"
                        aria-label="关闭"
                        onClick={onClose}
                        disabled={rollingBack}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="dialog-body" style={{ display: 'grid', gap: 12 }}>
                    {rollbackTarget ? (
                        <div
                            style={{
                                padding: '10px 12px',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-bg-secondary)',
                                fontSize: 13,
                                display: 'grid',
                                gap: 4,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>目标提交</span>
                                <code>{rollbackTarget.shortRevision?.trim() || formatRevisionTag(rollbackTarget.revision)}</code>
                            </div>
                            <div style={{ color: 'var(--color-text-primary)', fontWeight: 500, wordBreak: 'break-word' }}>
                                {rollbackTarget.message?.trim() || '未填写提交说明'}
                            </div>
                        </div>
                    ) : null}

                    {dirtyWarningVisible ? (
                        <div className="offline-conflict-copy" role="alert">
                            <AlertTriangle size={16} />
                            <div>
                                <strong>当前工作区有未保存或未提交的修改</strong>
                                <p>继续回滚将直接覆盖这些修改；如需先核对差异，可点击下方“先与工作区对比”。</p>
                            </div>
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="dialog-footer" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCompareWithWorktree}
                        disabled={rollingBack || !rollbackTarget}
                    >
                        <GitCompare size={14} aria-hidden="true" />
                        <span>先与工作区对比</span>
                    </Button>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                            disabled={rollingBack}
                        >
                            取消
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={onConfirmRollback}
                            disabled={rollingBack || savingFlow}
                        >
                            {rollingBack ? <LoaderCircle size={14} className="offline-spin" aria-hidden="true" /> : null}
                            <span>{rollingBack ? '回滚中…' : '确认回滚'}</span>
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
