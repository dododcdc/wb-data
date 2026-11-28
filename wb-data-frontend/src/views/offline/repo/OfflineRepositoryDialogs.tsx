import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileCode2, GitBranch, LoaderCircle } from 'lucide-react';

import type { BranchItem, DirtyFlowChange } from '../../../api/offline';
import { SimpleSelect } from '../../../components/SimpleSelect';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import type { BranchDirtyState } from './useOfflineRepositoryWorkflow';

function formatFlowPathDisplayName(flowPath: string) {
    const normalized = flowPath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const flowYamlIndex = segments.lastIndexOf('flow.yaml');
    if (flowYamlIndex > 0) {
        return segments[flowYamlIndex - 1];
    }
    return segments[segments.length - 1] ?? flowPath;
}

function getDirtyFlowStatusMeta(status: DirtyFlowChange['status']): { label: string; className: string } {
    if (status === 'ADDED') return { label: '新增', className: 'is-added' };
    if (status === 'DELETED') return { label: '已删除', className: 'is-deleted' };
    return { label: '已修改', className: 'is-modified' };
}

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
    currentBranchLabel: string;
    branchDirtyDialogOpen: boolean;
    branchDirtyState: BranchDirtyState | null;
    onBranchDirtyDialogOpenChange: (open: boolean) => void;
    onOpenRepoCommitFromDirtyDialog: () => void;
    rebuildDialogOpen: boolean;
    rebuildLoading: boolean;
    onRebuildDialogOpenChange: (open: boolean) => void;
    onRebuildRemote: () => void;
    createBranchDialogOpen?: boolean;
    branchCreating?: boolean;
    branches?: BranchItem[];
    onCreateBranchDialogOpenChange?: (open: boolean) => void;
    onCreateBranch?: (name: string, baseBranch: string) => Promise<boolean> | boolean;
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
    currentBranchLabel,
    branchDirtyDialogOpen,
    branchDirtyState,
    onBranchDirtyDialogOpenChange,
    onOpenRepoCommitFromDirtyDialog,
    rebuildDialogOpen,
    rebuildLoading,
    onRebuildDialogOpenChange,
    onRebuildRemote,
    createBranchDialogOpen = false,
    branchCreating = false,
    branches = [],
    onCreateBranchDialogOpenChange,
    onCreateBranch,
}: OfflineRepositoryDialogsProps) {
    const [newBranchName, setNewBranchName] = useState('');
    const [baseBranchName, setBaseBranchName] = useState('main');

    const baseBranchOptions = useMemo(() => {
        const names = new Set<string>();
        names.add('main');
        if (currentBranchLabel && currentBranchLabel !== '未初始化') {
            names.add(currentBranchLabel);
        }
        branches.forEach((b) => names.add(b.name));
        return Array.from(names).map((name) => ({ value: name, label: name }));
    }, [branches, currentBranchLabel]);

    useEffect(() => {
        if (!createBranchDialogOpen) return;
        setNewBranchName('');
        const defaultBase = baseBranchOptions.some((opt) => opt.value === 'main')
            ? 'main'
            : (baseBranchOptions[0]?.value ?? 'main');
        setBaseBranchName(defaultBase);
    }, [baseBranchOptions, createBranchDialogOpen]);

    const isSyncMainDirty = branchDirtyState?.action === 'sync-main';
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
                        ? `当前任务有未保存的画布草稿。切换到 ${pendingBranchSwitch} 前需要放弃这些草稿。`
                        : '当前任务有未保存的画布草稿，切换分支前需要放弃这些草稿。'
                }
                confirmText="放弃草稿并切换"
                variant="destructive"
                icon="warning"
                onConfirm={onConfirmDiscardDraftAndSwitchBranch}
                isLoading={branchSwitching}
            />

            <Dialog
                open={branchDirtyDialogOpen && branchDirtyState !== null}
                onOpenChange={onBranchDirtyDialogOpenChange}
            >
                <DialogContent className="offline-branch-dirty-dialog" style={{ maxWidth: '460px' }}>
                    <DialogHeader>
                        <div className="offline-branch-dirty-dialog-head">
                            <span className="offline-branch-dirty-dialog-icon" aria-hidden="true">
                                <AlertTriangle size={16} />
                            </span>
                            <DialogTitle>{isSyncMainDirty ? '同步 main 前请先提交改动' : '切换分支前请先提交改动'}</DialogTitle>
                        </div>
                        <DialogDescription>
                            {isSyncMainDirty
                                ? `当前分支（${currentBranchLabel}）仍有未提交改动，暂无法同步 main 最新改动。请先提交仓库改动后再同步。`
                                : branchDirtyState?.targetBranch
                                    ? `当前分支（${currentBranchLabel}）仍有未提交改动，暂无法切换到「${branchDirtyState.targetBranch}」。请先提交仓库改动后再切换。`
                                    : `当前分支（${currentBranchLabel}）仍有未提交改动，请先提交仓库改动后再切换分支。`}
                        </DialogDescription>
                    </DialogHeader>

                    {branchDirtyState ? (
                        <div className="offline-branch-dirty-dialog-body">
                            {branchDirtyState.changedFlowDetails.length > 0 ? (
                                <>
                                    <ul className="offline-branch-dirty-dialog-list" aria-label="待提交的任务清单">
                                        {branchDirtyState.changedFlowDetails.map((flow) => {
                                            const statusMeta = getDirtyFlowStatusMeta(flow.status);
                                            return (
                                                <li key={flow.path} className="offline-branch-dirty-dialog-row" title={flow.path}>
                                                    <span className="offline-branch-dirty-dialog-name">
                                                        <FileCode2 size={14} aria-hidden="true" />
                                                        <span>{formatFlowPathDisplayName(flow.path)}</span>
                                                    </span>
                                                    <span className={`offline-branch-dirty-dialog-tag ${statusMeta.className}`}>
                                                        {statusMeta.label}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    {branchDirtyState.otherFileCount > 0 ? (
                                        <p className="offline-branch-dirty-dialog-note">
                                            另外还有 {branchDirtyState.otherFileCount} 个仓库文件未提交。
                                        </p>
                                    ) : null}
                                </>
                            ) : (
                                <p className="offline-branch-dirty-dialog-note">
                                    {branchDirtyState.otherFileCount > 0
                                        ? `当前工作区还有 ${branchDirtyState.otherFileCount} 个仓库文件未提交。`
                                        : '当前仓库有已保存但未提交的改动。'}
                                </p>
                            )}
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onBranchDirtyDialogOpenChange(false)}>
                            知道了
                        </Button>
                        <Button
                            type="button"
                            variant="default"
                            aria-label="打开提交仓库改动"
                            onClick={onOpenRepoCommitFromDirtyDialog}
                        >
                            提交仓库改动
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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

            <Dialog
                open={createBranchDialogOpen}
                onOpenChange={(open) => {
                    if (!open && branchCreating) return;
                    onCreateBranchDialogOpenChange?.(open);
                }}
            >
                <DialogContent style={{ maxWidth: '420px' }}>
                    <DialogHeader>
                        <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <GitBranch size={16} />
                            <span>新建开发分支</span>
                        </DialogTitle>
                        <DialogDescription>
                            为当前需求新建一个独立分支工作区，开发完成后可由管理员合并回 main。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <label htmlFor="offline-new-branch-name" style={{ fontSize: '0.84rem', fontWeight: 500 }}>
                                分支名称
                            </label>
                            <Input
                                id="offline-new-branch-name"
                                value={newBranchName}
                                onChange={(e) => setNewBranchName(e.target.value)}
                                placeholder="例如 feature/order-etl"
                                disabled={branchCreating}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newBranchName.trim() && !branchCreating) {
                                        void onCreateBranch?.(newBranchName, baseBranchName);
                                    }
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <label style={{ fontSize: '0.84rem', fontWeight: 500 }}>
                                基于分支
                            </label>
                            <SimpleSelect
                                value={baseBranchName}
                                onChange={setBaseBranchName}
                                options={baseBranchOptions}
                                disabled={branchCreating}
                                ariaLabel="选择基础分支"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onCreateBranchDialogOpenChange?.(false)}
                            disabled={branchCreating}
                        >
                            取消
                        </Button>
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => void onCreateBranch?.(newBranchName, baseBranchName)}
                            disabled={branchCreating || !newBranchName.trim()}
                        >
                            {branchCreating ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {branchCreating ? '创建中…' : '创建并切换'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
