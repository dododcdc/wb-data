import { useCallback, useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import {
    commitOfflineRepo,
    getOfflineRepoRemote,
    getOfflineRepoStatus,
    listBranches,
    pushOfflineRepo,
    rebuildOfflineRepo,
    switchBranch,
    type BranchItem,
    type DirtyFlowChange,
    type DirtyWorkingTreeResponse,
    type OfflineRepoStatus,
    type RemoteStatus,
} from '../../api/offline';
import { getErrorMessage } from '../../utils/error';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';

interface UseOfflineRepositoryWorkflowParams {
    groupId: number | null;
    canManageBranches: boolean;
    hasUnsavedFlowDraft: boolean;
    showFeedback: (payload: FeedbackPayload) => void;
}

export interface BranchDirtyState {
    changedFlows: string[];
    changedFlowDetails: DirtyFlowChange[];
    otherFileCount: number;
}

interface BranchSwitchCallbacks {
    discardDraft?: () => void | Promise<void>;
    afterSwitch?: (branchName: string) => void | Promise<void>;
}

interface RequestBranchSwitchOptions extends BranchSwitchCallbacks {
    hasUnsavedDraft?: boolean;
}

interface CommitRepoOptions {
    saveCurrentFlowBeforeCommit?: () => Promise<boolean>;
    afterCommit?: () => Promise<void>;
}

function readDirtyFlowChanges(details: Record<string, unknown>, changedFlows: string[]): DirtyFlowChange[] {
    if (Array.isArray(details.changedFlowDetails)) {
        return details.changedFlowDetails.flatMap((item): DirtyFlowChange[] => {
            if (!item || typeof item !== 'object') {
                return [];
            }
            const candidate = item as Record<string, unknown>;
            if (typeof candidate.path !== 'string') {
                return [];
            }
            const status = candidate.status === 'ADDED' || candidate.status === 'DELETED' ? candidate.status : 'MODIFIED';
            return [{ path: candidate.path, status }];
        });
    }
    return changedFlows.map((path) => ({ path, status: 'MODIFIED' }));
}

function readDirtyWorkingTreeDetails(error: unknown): DirtyWorkingTreeResponse | null {
    if (!(error instanceof AxiosError) || error.response?.status !== 409) {
        return null;
    }
    const details = error.response.data?.data;
    if (!details || typeof details !== 'object') {
        return null;
    }
    const detailRecord = details as Record<string, unknown>;
    const changedFlows = Array.isArray(detailRecord.changedFlows)
        ? detailRecord.changedFlows.filter((item: unknown): item is string => typeof item === 'string')
        : [];
    return {
        changedFlows,
        changedFiles: Array.isArray(details.changedFiles)
            ? details.changedFiles.filter((item: unknown): item is string => typeof item === 'string')
            : [],
        otherFileCount: typeof details.otherFileCount === 'number' ? details.otherFileCount : 0,
        changedFlowDetails: readDirtyFlowChanges(detailRecord, changedFlows),
    };
}

export function useOfflineRepositoryWorkflow({
    groupId,
    canManageBranches,
    hasUnsavedFlowDraft,
    showFeedback,
}: UseOfflineRepositoryWorkflowParams) {
    const [repoStatus, setRepoStatus] = useState<OfflineRepoStatus | null>(null);
    const [repoLoading, setRepoLoading] = useState(false);
    const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
    const [pushLoading, setPushLoading] = useState(false);
    const [pushDialogOpen, setPushDialogOpen] = useState(false);
    const [rebuildLoading, setRebuildLoading] = useState(false);
    const [rebuildDialogOpen, setRebuildDialogOpen] = useState(false);
    const [branchMenuOpen, setBranchMenuOpen] = useState(false);
    const [branchTooltipOpen, setBranchTooltipOpen] = useState(false);
    const [branchLoading, setBranchLoading] = useState(false);
    const [branches, setBranches] = useState<BranchItem[]>([]);
    const [branchSwitching, setBranchSwitching] = useState(false);
    const [branchDirtyState, setBranchDirtyState] = useState<BranchDirtyState | null>(null);
    const [pendingBranchSwitch, setPendingBranchSwitch] = useState<string | null>(null);
    const [discardBranchSwitchOpen, setDiscardBranchSwitchOpen] = useState(false);
    const groupIdRef = useRef(groupId);
    const actionVersionRef = useRef(0);
    const pendingBranchSwitchCallbacksRef = useRef<BranchSwitchCallbacks | null>(null);

    useEffect(() => {
        if (groupIdRef.current !== groupId) {
            groupIdRef.current = groupId;
            actionVersionRef.current += 1;
            setRepoStatus(null);
            setRemoteStatus(null);
            setPushDialogOpen(false);
            setRebuildDialogOpen(false);
            setBranchMenuOpen(false);
            setBranches([]);
            setBranchDirtyState(null);
            setPendingBranchSwitch(null);
            setDiscardBranchSwitchOpen(false);
            pendingBranchSwitchCallbacksRef.current = null;
        }
    }, [groupId]);

    const captureGroupActionGuard = useCallback((expectedGroupId: number | null) => {
        const version = actionVersionRef.current;
        return () => groupIdRef.current === expectedGroupId && actionVersionRef.current === version;
    }, []);

    const refreshRepoStatus = useCallback(async () => {
        if (!groupId) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setRepoLoading(true);
        try {
            const nextStatus = await getOfflineRepoStatus(groupId);
            if (!isCurrentGroupAction()) return;
            setRepoStatus(nextStatus);
        } catch (error) {
            if (!isCurrentGroupAction()) return;
            showFeedback({
                tone: 'error',
                title: '仓库状态读取失败',
                detail: getErrorMessage(error, '暂时无法读取本地仓库状态。'),
            });
        } finally {
            if (isCurrentGroupAction()) {
                setRepoLoading(false);
            }
        }
    }, [captureGroupActionGuard, groupId, showFeedback]);

    const refreshRemoteStatus = useCallback(async () => {
        if (!groupId) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        try {
            const nextRemoteStatus = await getOfflineRepoRemote(groupId);
            if (isCurrentGroupAction()) {
                setRemoteStatus(nextRemoteStatus);
            }
        } catch {
            if (isCurrentGroupAction()) {
                setRemoteStatus(null);
            }
        }
    }, [captureGroupActionGuard, groupId]);

    const branchLabel = repoStatus?.gitInitialized ? repoStatus.branch ?? 'main' : '未初始化';
    const canSwitchBranch = canManageBranches && !!groupId && !!repoStatus?.gitInitialized;
    const canCommitRepo = !!groupId && !!repoStatus?.gitInitialized && (hasUnsavedFlowDraft || !!repoStatus?.dirty);
    const canPush = !!groupId
        && !!repoStatus?.gitInitialized
        && !!repoStatus?.headCommitId
        && !(repoStatus?.hasRemote && !repoStatus?.ahead && repoStatus?.hasUpstream);

    const loadBranchList = useCallback(async () => {
        if (!groupId || !canSwitchBranch) return;
        setBranchLoading(true);
        try {
            const response = await listBranches(groupId);
            setBranches(response.branches);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '分支列表读取失败',
                detail: getErrorMessage(error, '暂时无法读取本地分支。'),
            });
        } finally {
            setBranchLoading(false);
        }
    }, [canSwitchBranch, groupId, showFeedback]);

    const toggleBranchMenu = useCallback(() => {
        if (!canSwitchBranch) return;
        setBranchMenuOpen((open) => {
            const nextOpen = !open;
            if (nextOpen) {
                void loadBranchList();
            }
            return nextOpen;
        });
    }, [canSwitchBranch, loadBranchList]);

    const resetBranchList = useCallback(() => {
        setBranchMenuOpen(false);
        setBranches([]);
    }, []);

    const resetBranchSwitchState = useCallback(() => {
        setBranchDirtyState(null);
        setPendingBranchSwitch(null);
        setDiscardBranchSwitchOpen(false);
        pendingBranchSwitchCallbacksRef.current = null;
    }, []);

    const executeBranchSwitch = useCallback(async (
        branchName: string,
        options: { discardDraft?: boolean; callbacks?: BranchSwitchCallbacks } = {},
    ) => {
        if (!groupId || !canSwitchBranch || branchName === branchLabel) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);

        setBranchSwitching(true);
        try {
            if (options.discardDraft) {
                await options.callbacks?.discardDraft?.();
            }

            await switchBranch(groupId, branchName);
            if (!isCurrentGroupAction()) return;

            setBranchDirtyState(null);
            setBranchMenuOpen(false);
            setPendingBranchSwitch(null);
            setDiscardBranchSwitchOpen(false);
            pendingBranchSwitchCallbacksRef.current = null;
            window.dispatchEvent(new CustomEvent('wbdata:offline-branch-changed', {
                detail: { groupId, branch: branchName, source: 'workbench' },
            }));
            await options.callbacks?.afterSwitch?.(branchName);
            if (!isCurrentGroupAction()) return;
            showFeedback({ tone: 'success', title: '分支已切换', detail: branchName });
        } catch (error) {
            if (!isCurrentGroupAction()) return;
            const dirtyDetails = readDirtyWorkingTreeDetails(error);
            if (dirtyDetails) {
                setBranchDirtyState({
                    changedFlows: dirtyDetails.changedFlows,
                    changedFlowDetails: dirtyDetails.changedFlowDetails ?? dirtyDetails.changedFlows.map((path) => ({ path, status: 'MODIFIED' })),
                    otherFileCount: dirtyDetails.otherFileCount,
                });
                setBranchMenuOpen(true);
                showFeedback({
                    tone: 'error',
                    title: '工作区有未提交改动',
                    detail: dirtyDetails.changedFlows.length > 0
                        ? `还有 ${dirtyDetails.changedFlows.length} 个已保存但未提交的 Flow，请提交仓库改动后再切换分支。`
                        : '请提交仓库改动后再切换分支。',
                });
                return;
            }
            setBranchDirtyState(null);
            showFeedback({
                tone: 'error',
                title: '切换分支失败',
                detail: getErrorMessage(error, ''),
            });
        } finally {
            if (isCurrentGroupAction()) {
                setBranchSwitching(false);
            }
        }
    }, [branchLabel, canSwitchBranch, captureGroupActionGuard, groupId, showFeedback]);

    const requestBranchSwitch = useCallback((branchName: string, options: RequestBranchSwitchOptions = {}) => {
        if (!canSwitchBranch || branchName === branchLabel) return;
        if (options.hasUnsavedDraft) {
            pendingBranchSwitchCallbacksRef.current = {
                discardDraft: options.discardDraft,
                afterSwitch: options.afterSwitch,
            };
            setPendingBranchSwitch(branchName);
            setDiscardBranchSwitchOpen(true);
            return;
        }
        pendingBranchSwitchCallbacksRef.current = null;
        void executeBranchSwitch(branchName, { callbacks: options });
    }, [branchLabel, canSwitchBranch, executeBranchSwitch]);

    const confirmDiscardDraftAndSwitchBranch = useCallback(() => {
        if (!pendingBranchSwitch) {
            setDiscardBranchSwitchOpen(false);
            pendingBranchSwitchCallbacksRef.current = null;
            return;
        }
        void executeBranchSwitch(pendingBranchSwitch, {
            discardDraft: true,
            callbacks: pendingBranchSwitchCallbacksRef.current ?? undefined,
        });
    }, [executeBranchSwitch, pendingBranchSwitch]);

    const setDiscardBranchSwitchDialogOpen = useCallback((open: boolean) => {
        setDiscardBranchSwitchOpen(open);
        if (!open) {
            setPendingBranchSwitch(null);
            pendingBranchSwitchCallbacksRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!repoStatus?.dirty) {
            setBranchDirtyState(null);
        }
    }, [repoStatus?.dirty]);

    const push = useCallback(async () => {
        if (!groupId) return;
        setPushLoading(true);
        try {
            const result = await pushOfflineRepo(groupId);
            if (result.success) {
                setPushDialogOpen(false);
                showFeedback({ tone: 'success', title: '推送成功', detail: '' });
                await refreshRemoteStatus();
                await refreshRepoStatus();
            } else if (result.remoteDeleted) {
                setPushDialogOpen(false);
                setRebuildDialogOpen(true);
            } else {
                showFeedback({ tone: 'error', title: result.message, detail: '' });
            }
        } catch {
            showFeedback({ tone: 'error', title: '推送失败', detail: '' });
        } finally {
            setPushLoading(false);
        }
    }, [groupId, refreshRemoteStatus, refreshRepoStatus, showFeedback]);

    const commitRepo = useCallback(async (message: string, options: CommitRepoOptions = {}) => {
        if (!groupId) return false;
        try {
            if (options.saveCurrentFlowBeforeCommit) {
                const saved = await options.saveCurrentFlowBeforeCommit();
                if (!saved) return false;
            }
            const result = await commitOfflineRepo(groupId, message);
            if (result.success) {
                await Promise.all([refreshRepoStatus(), options.afterCommit?.()]);
                showFeedback({ tone: 'success', title: result.message, detail: '' });
                return true;
            }
            return false;
        } catch {
            showFeedback({ tone: 'error', title: '仓库提交失败', detail: '' });
            return false;
        }
    }, [groupId, refreshRepoStatus, showFeedback]);

    const rebuildRemote = useCallback(async () => {
        if (!groupId) return;
        setRebuildLoading(true);
        try {
            const result = await rebuildOfflineRepo(groupId);
            if (result.success) {
                setRebuildDialogOpen(false);
                showFeedback({ tone: 'success', title: '推送成功', detail: '' });
                await refreshRemoteStatus();
                await refreshRepoStatus();
            } else {
                showFeedback({ tone: 'error', title: result.message, detail: '' });
            }
        } catch {
            showFeedback({ tone: 'error', title: '推送失败', detail: '' });
        } finally {
            setRebuildLoading(false);
        }
    }, [groupId, refreshRemoteStatus, refreshRepoStatus, showFeedback]);

    return {
        repoStatus,
        repoLoading,
        remoteStatus,
        branchLabel,
        canSwitchBranch,
        canCommitRepo,
        canPush,
        pushLoading,
        pushDialogOpen,
        setPushDialogOpen,
        rebuildLoading,
        rebuildDialogOpen,
        setRebuildDialogOpen,
        branchMenuOpen,
        setBranchMenuOpen,
        branchTooltipOpen,
        setBranchTooltipOpen,
        branchLoading,
        branches,
        loadBranchList,
        toggleBranchMenu,
        resetBranchList,
        branchSwitching,
        branchDirtyState,
        pendingBranchSwitch,
        discardBranchSwitchOpen,
        setDiscardBranchSwitchOpen: setDiscardBranchSwitchDialogOpen,
        requestBranchSwitch,
        confirmDiscardDraftAndSwitchBranch,
        resetBranchSwitchState,
        refreshRepoStatus,
        refreshRemoteStatus,
        commitRepo,
        push,
        rebuildRemote,
    };
}
