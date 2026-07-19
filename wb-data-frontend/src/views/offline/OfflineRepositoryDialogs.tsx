import { LoaderCircle } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';

interface OfflineRepositoryDialogsProps {
    pushDialogOpen: boolean;
    pushLoading: boolean;
    onPushDialogOpenChange: (open: boolean) => void;
    onPush: () => void;
    discardBranchSwitchOpen: boolean;
    branchSwitching: boolean;
    pendingBranchSwitch: string | null;
    onDiscardBranchSwitchOpenChange: (open: boolean) => void;
    onConfirmDiscardDraftAndSwitchBranch: () => void;
    rebuildDialogOpen: boolean;
    rebuildLoading: boolean;
    onRebuildDialogOpenChange: (open: boolean) => void;
    onRebuildRemote: () => void;
}

export function OfflineRepositoryDialogs({
    pushDialogOpen,
    pushLoading,
    onPushDialogOpenChange,
    onPush,
    discardBranchSwitchOpen,
    branchSwitching,
    pendingBranchSwitch,
    onDiscardBranchSwitchOpenChange,
    onConfirmDiscardDraftAndSwitchBranch,
    rebuildDialogOpen,
    rebuildLoading,
    onRebuildDialogOpenChange,
    onRebuildRemote,
}: OfflineRepositoryDialogsProps) {
    return (
        <>
            <Dialog open={pushDialogOpen} onOpenChange={onPushDialogOpenChange}>
                <DialogContent style={{ maxWidth: '420px' }}>
                    <DialogHeader>
                        <DialogTitle>推送</DialogTitle>
                        <DialogDescription className="sr-only">
                            确认将本地提交推送到远端仓库
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body">
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                            将本地提交推送到远端仓库，推送后其他成员可以拉取最新内容。
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onPushDialogOpenChange(false)} disabled={pushLoading}>
                            取消
                        </Button>
                        <Button variant="default" onClick={onPush} disabled={pushLoading}>
                            {pushLoading ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {pushLoading ? '推送中…' : '推送'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={discardBranchSwitchOpen}
                onOpenChange={(open) => {
                    if (!open && branchSwitching) return;
                    onDiscardBranchSwitchOpenChange(open);
                }}
                title="放弃画布草稿并切换分支"
                description={
                    pendingBranchSwitch
                        ? `当前 Flow 有未保存的画布草稿。切换到 ${pendingBranchSwitch} 前需要放弃这些草稿。`
                        : '当前 Flow 有未保存的画布草稿，切换分支前需要放弃这些草稿。'
                }
                confirmText="放弃草稿并切换"
                variant="destructive"
                icon="warning"
                onConfirm={onConfirmDiscardDraftAndSwitchBranch}
                isLoading={branchSwitching}
            />

            <Dialog open={rebuildDialogOpen} onOpenChange={onRebuildDialogOpenChange}>
                <DialogContent style={{ maxWidth: '420px' }}>
                    <DialogHeader>
                        <DialogTitle>远程仓库已不存在</DialogTitle>
                        <DialogDescription className="sr-only">
                            远程仓库已被删除，是否重建并推送
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body">
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                            远程仓库已被删除，是否重建仓库并推送本地内容？
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onRebuildDialogOpenChange(false)} disabled={rebuildLoading}>
                            取消
                        </Button>
                        <Button variant="default" onClick={onRebuildRemote} disabled={rebuildLoading}>
                            {rebuildLoading ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {rebuildLoading ? '推送中…' : '重建并推送'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
