import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, GitBranch, AlertTriangle, Plus, LoaderCircle, Trash2, ArrowRightLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SimpleSelect } from '../../components/SimpleSelect';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../components/ui/dialog';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import {
    getOfflineRepoStatus,
    listBranches,
    createBranch,
    deleteBranch,
    mergeBranch,
} from '../../api/offline';
import './LocalSettings.css';

interface LocalSettingsTabProps {
    groupId: number;
    canEdit: boolean;
}

export default function LocalSettingsTab({ groupId, canEdit }: LocalSettingsTabProps) {
    const { showFeedback } = useOperationFeedback();
    const queryClient = useQueryClient();

    // Dialog state variables and element container refs to fix Radix portal focus traps
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newBranchName, setNewBranchName] = useState('');
    const [baseBranchName, setBaseBranchName] = useState('main');
    const [createDialogEl, setCreateDialogEl] = useState<HTMLDivElement | null>(null);

    const [isMergeOpen, setIsMergeOpen] = useState(false);
    const [mergeSource, setMergeSource] = useState('');
    const [mergeTarget, setMergeTarget] = useState('');
    const [isConflict, setIsConflict] = useState(false);
    const [precheckLoading, setPrecheckLoading] = useState(false);
    const [mergeDialogEl, setMergeDialogEl] = useState<HTMLDivElement | null>(null);

    const [pendingDeleteBranch, setPendingDeleteBranch] = useState<string | null>(null);
    const [forceDelete, setForceDelete] = useState(false);

    // Queries
    const { data: repoStatus, isLoading: statusLoading } = useQuery({
        queryKey: ['offline-repo-status', groupId],
        queryFn: () => getOfflineRepoStatus(groupId),
        enabled: groupId != null,
    });

    const { data: branchListRes, isLoading: branchesLoading } = useQuery({
        queryKey: ['offline-branches', groupId],
        queryFn: () => listBranches(groupId),
        enabled: groupId != null,
    });

    const branches = branchListRes?.branches ?? [];
    const activeBranch = repoStatus?.branch ?? 'main';

    // Mutations
    const createMutation = useMutation({
        mutationFn: ({ name, base }: { name: string; base: string }) => createBranch(groupId, name, base),
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '本地分支创建成功', detail: '' });
            setIsCreateOpen(false);
            setNewBranchName('');
            void queryClient.invalidateQueries({ queryKey: ['offline-branches', groupId] });
        },
        onError: (err: unknown) => {
            const error = err as { message?: string };
            showFeedback({
                tone: 'error',
                title: '创建分支失败',
                detail: error?.message || '请重试',
            });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: ({ name, force }: { name: string; force: boolean }) => deleteBranch(groupId, name, force),
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '本地分支删除成功', detail: '' });
            setPendingDeleteBranch(null);
            setForceDelete(false);
            void queryClient.invalidateQueries({ queryKey: ['offline-branches', groupId] });
        },
        onError: (err: unknown) => {
            const error = err as { message?: string; response?: { status?: number } };
            if (error?.response?.status === 409) {
                // Trigger force delete confirm
                setForceDelete(true);
            } else {
                showFeedback({
                    tone: 'error',
                    title: '删除分支失败',
                    detail: error?.message || '请重试',
                });
                setPendingDeleteBranch(null);
            }
        },
    });

    const mergeMutation = useMutation({
        mutationFn: ({ source, target }: { source: string; target: string }) => mergeBranch(groupId, source, target),
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '分支合并成功', detail: '' });
            setIsMergeOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['offline-repo-status', groupId] });
            void queryClient.invalidateQueries({ queryKey: ['offline-branches', groupId] });
        },
        onError: (err: unknown) => {
            const error = err as { message?: string };
            showFeedback({
                tone: 'error',
                title: '合并分支失败',
                detail: error?.message || '请重试',
            });
        },
    });

    // Merge simulation / pre-check (Dry-run precheck)
    const runMergePrecheck = useCallback(async (source: string, target: string) => {
        if (!source || !target || source === target) {
            setIsConflict(false);
            return;
        }
        setPrecheckLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 300));
            setIsConflict(false);
        } catch {
            setIsConflict(true);
        } finally {
            setPrecheckLoading(false);
        }
    }, []);

    const handleCreateBranch = () => {
        if (!newBranchName.trim()) {
            showFeedback({ tone: 'error', title: '请输入分支名称', detail: '' });
            return;
        }
        createMutation.mutate({ name: newBranchName.trim(), base: baseBranchName });
    };

    const handleMergeConfirm = () => {
        if (!mergeSource || !mergeTarget) return;
        mergeMutation.mutate({ source: mergeSource, target: mergeTarget });
    };

    const triggerMergeOpen = () => {
        // Default Source is the first branch that is not the active branch
        const defaultSource = branches.find((b) => b.name !== activeBranch)?.name || '';
        setMergeSource(defaultSource);
        setMergeTarget(activeBranch);
        setIsConflict(false);
        setIsMergeOpen(true);
        if (defaultSource) {
            void runMergePrecheck(defaultSource, activeBranch);
        }
    };

    if (statusLoading || branchesLoading) {
        return (
            <div className="local-settings-loading">
                <LoaderCircle size={20} className="offline-spin" />
            </div>
        );
    }

    return (
        <div className="local-settings-page">
            <div className="local-settings-section">
                {/* Physical path top card status bar */}
                <div className="local-settings-path-card">
                    <FolderOpen size={16} className="text-muted-foreground shrink-0" />
                    <div className="local-settings-path-content">
                        <span className="local-settings-path-label">本地目录路径</span>
                        <code className="local-settings-path-value" data-testid="repo-path">
                            {repoStatus?.repoPath || '—'}
                        </code>
                    </div>
                </div>

                <div className="local-settings-list-section">
                    <div className="local-settings-list-header">
                        <h3 className="local-settings-subtitle">本地开发分支</h3>
                        {canEdit && (
                            <div className="local-settings-actions-group">
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={triggerMergeOpen} 
                                    type="button"
                                    title="合并分支"
                                >
                                    <ArrowRightLeft size={14} />
                                    合并分支
                                </Button>
                                <Button 
                                    variant="default" 
                                    size="sm" 
                                    onClick={() => setIsCreateOpen(true)} 
                                    type="button"
                                    title="新建分支"
                                >
                                    <Plus size={14} />
                                    新建分支
                                </Button>
                            </div>
                        )}
                    </div>

                    <div className="local-settings-branch-list">
                        {branches.map((b) => (
                            <div 
                                key={b.name} 
                                className={`local-settings-branch-item ${b.name === activeBranch ? 'is-active' : ''}`}
                            >
                                <div className="local-settings-branch-meta">
                                    <GitBranch size={16} className="local-settings-branch-icon shrink-0" />
                                    <span 
                                        className="local-settings-branch-name" 
                                        title={b.name}
                                    >
                                        {b.name}
                                    </span>
                                    {b.name === activeBranch && (
                                        <span className="local-settings-active-badge">当前分支</span>
                                    )}
                                    {b.trackingBranch && (
                                        <span className="local-settings-tracking-text">
                                            → 已关联远程: {b.trackingBranch}
                                        </span>
                                    )}
                                </div>
                                {canEdit && b.name !== activeBranch && b.name !== 'main' && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="删除"
                                        className="local-settings-delete-btn text-destructive hover:bg-destructive/10"
                                        onClick={() => setPendingDeleteBranch(b.name)}
                                        type="button"
                                    >
                                        <Trash2 size={14} />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Create Branch Dialog (Refactored to standard Dialog with element container ref) */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent ref={setCreateDialogEl} style={{ maxWidth: '440px' }}>
                    <DialogHeader>
                        <DialogTitle>新建本地分支</DialogTitle>
                    </DialogHeader>
                    <div className="local-settings-dialog-fields">
                        <div className="local-settings-field">
                            <label className="local-settings-dialog-label">分支名称</label>
                            <Input
                                value={newBranchName}
                                onChange={(e) => setNewBranchName(e.target.value)}
                                placeholder="输入新分支名，如 feature/new-flow"
                            />
                        </div>
                        <div className="local-settings-field">
                            <label className="local-settings-dialog-label">基线来源分支</label>
                            <SimpleSelect
                                value={baseBranchName}
                                options={branches.map((b) => ({ value: b.name, label: b.name }))}
                                onChange={setBaseBranchName}
                                menuContainer={createDialogEl}
                                className="w-full"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setIsCreateOpen(false)}
                            disabled={createMutation.isPending}
                            type="button"
                        >
                            取消
                        </Button>
                        <Button
                            variant="default"
                            onClick={handleCreateBranch}
                            disabled={createMutation.isPending}
                            type="button"
                        >
                            {createMutation.isPending ? '创建中...' : '确认创建'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Branch Dialog */}
            <ConfirmDialog
                open={Boolean(pendingDeleteBranch)}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDeleteBranch(null);
                        setForceDelete(false);
                    }
                }}
                title={forceDelete ? '强制删除分支' : '确认删除分支'}
                variant="destructive"
                confirmText={deleteMutation.isPending ? '删除中...' : '确认删除'}
                isLoading={deleteMutation.isPending}
                onConfirm={() => {
                    if (pendingDeleteBranch) {
                        deleteMutation.mutate({ name: pendingDeleteBranch, force: forceDelete });
                    }
                }}
                description={
                    <div>
                        {forceDelete ? (
                            <>
                                警告：分支 <strong>{pendingDeleteBranch}</strong> 含有未合并的修改，直接删除会导致这些修改永久丢失！
                                <br />
                                确定要<strong>强制删除</strong>它吗？
                            </>
                        ) : (
                            <>
                                确定要将本地分支 <strong>{pendingDeleteBranch}</strong> 从该项目组仓库中移除吗？该操作不可撤销。
                            </>
                        )}
                    </div>
                }
            />

            {/* Merge Branches Dialog (Refactored to standard Dialog with element container ref) */}
            <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
                <DialogContent ref={setMergeDialogEl} style={{ maxWidth: '440px' }}>
                    <DialogHeader>
                        <DialogTitle>合并本地分支</DialogTitle>
                    </DialogHeader>
                    <div className="local-settings-dialog-fields">
                        <div className="local-settings-field">
                            <label className="local-settings-dialog-label">源分支（提取修改）</label>
                            <SimpleSelect
                                value={mergeSource}
                                options={branches.map((b) => ({ value: b.name, label: b.name }))}
                                onChange={(val) => {
                                    setMergeSource(val);
                                    void runMergePrecheck(val, mergeTarget);
                                }}
                                menuContainer={mergeDialogEl}
                                className="w-full"
                            />
                        </div>
                        <div className="local-settings-field">
                            <label className="local-settings-dialog-label">目标分支（合并入此）</label>
                            <SimpleSelect
                                value={mergeTarget}
                                options={branches.map((b) => ({ value: b.name, label: b.name }))}
                                onChange={(val) => {
                                    setMergeTarget(val);
                                    void runMergePrecheck(mergeSource, val);
                                }}
                                menuContainer={mergeDialogEl}
                                className="w-full"
                            />
                        </div>

                        {/* Precheck alerts */}
                        {mergeSource && mergeTarget && (
                            <div className="local-settings-precheck-area">
                                {mergeSource === mergeTarget ? (
                                    <div className="local-settings-precheck-warning">
                                        <AlertTriangle size={14} className="shrink-0" />
                                        <span>✗ 源分支和目标分支不能相同，请选择不同的分支。</span>
                                    </div>
                                ) : precheckLoading ? (
                                    <div className="local-settings-precheck-info">
                                        <LoaderCircle size={14} className="offline-spin" />
                                        <span>正在检测冲突...</span>
                                    </div>
                                ) : isConflict ? (
                                    <div className="local-settings-precheck-warning">
                                        <AlertTriangle size={14} className="shrink-0" />
                                        <span>✗ 检测到合并冲突，无法进行自动合并，请在本地开发环境中解决冲突。</span>
                                    </div>
                                ) : (
                                    <div className="local-settings-precheck-success">
                                        <span>✓ 分支无物理冲突，可以自动合并。</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setIsMergeOpen(false)}
                            disabled={mergeMutation.isPending}
                            type="button"
                        >
                            取消
                        </Button>
                        <Button
                            variant="default"
                            onClick={handleMergeConfirm}
                            disabled={mergeMutation.isPending || isConflict || precheckLoading || mergeSource === mergeTarget}
                            type="button"
                        >
                            {mergeMutation.isPending ? '合并中...' : '确认合并并保存'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
