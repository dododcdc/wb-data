import { useCallback, useEffect, useState } from 'react';
import { pushOfflineCurrentFlow, type OfflineFlowDocument } from '../../../api/offline';
import type { FeedbackPayload } from '../../../hooks/useOperationFeedback';
import type { CommitMode } from './OfflineCommitDialogs';

interface CommitRepoOptions {
    saveCurrentFlowBeforeCommit?: () => Promise<boolean>;
    afterCommit?: () => Promise<void>;
}

interface UseOfflinePublishWorkflowParams {
    groupId: number | null;
    activeFlowPath: string | null;
    flowDocument: OfflineFlowDocument | null;
    isGroupAdmin: boolean;
    isDirty: boolean;
    activeRollbackIssues: Record<string, string>;
    validateDocumentForAction: () => boolean;
    flushDraftNow: () => Promise<boolean>;
    commitCurrentFlow: (message: string, mode: CommitMode) => Promise<boolean>;
    commitRepository: (message: string, options?: CommitRepoOptions) => Promise<boolean>;
    refreshRemoteStatus: () => Promise<void>;
    refreshRepoStatus: () => Promise<void>;
    refreshFlowCommitStatus: () => Promise<void>;
    refreshDeployment: () => void;
    setRebuildDialogOpen: (open: boolean) => void;
    showFeedback: (payload: FeedbackPayload) => void;
    showError: (error: unknown, title: string, fallbackDetail?: string) => void;
}

export function useOfflinePublishWorkflow({
    groupId,
    activeFlowPath,
    flowDocument,
    isGroupAdmin,
    isDirty,
    activeRollbackIssues,
    validateDocumentForAction,
    flushDraftNow,
    commitCurrentFlow,
    commitRepository,
    refreshRemoteStatus,
    refreshRepoStatus,
    refreshFlowCommitStatus,
    refreshDeployment,
    setRebuildDialogOpen,
    showFeedback,
    showError,
}: UseOfflinePublishWorkflowParams) {
    const [flowCommitDialogOpen, setFlowCommitDialogOpen] = useState(false);
    const [flowPushDialogOpen, setFlowPushDialogOpen] = useState(false);
    const [repoCommitDialogOpen, setRepoCommitDialogOpen] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');
    const [committing, setCommitting] = useState(false);
    const [pushingFlow, setPushingFlow] = useState(false);

    useEffect(() => {
        setFlowPushDialogOpen(false);
    }, [groupId, activeFlowPath]);

    const handleConfirmPushCurrentFlow = useCallback(async () => {
        if (!groupId || !activeFlowPath || pushingFlow) return;
        const targetGroupId = groupId;
        const targetFlowPath = activeFlowPath;
        setPushingFlow(true);
        try {
            const result = await pushOfflineCurrentFlow(targetGroupId, targetFlowPath);
            if (result.success) {
                setFlowPushDialogOpen(false);
                showFeedback({
                    tone: 'success',
                    title: '当前任务推送成功',
                    detail: result.message && result.message !== '当前任务推送成功' ? result.message : '',
                });
                await Promise.all([
                    refreshRemoteStatus(),
                    refreshRepoStatus(),
                    refreshFlowCommitStatus(),
                ]);
                refreshDeployment();
            } else if (result.remoteDeleted) {
                setFlowPushDialogOpen(false);
                if (isGroupAdmin) {
                    setRebuildDialogOpen(true);
                } else {
                    showFeedback({
                        tone: 'error',
                        title: '远程仓库已不存在',
                        detail: '请联系项目组管理员在左侧仓库工具栏恢复远程仓库后再推送',
                    });
                }
            } else {
                showFeedback({
                    tone: 'error',
                    title: '当前任务推送失败',
                    detail: result.message || '',
                });
            }
        } catch (error) {
            showError(error, '当前任务推送失败');
        } finally {
            setPushingFlow(false);
        }
    }, [
        activeFlowPath,
        groupId,
        isGroupAdmin,
        pushingFlow,
        refreshDeployment,
        refreshFlowCommitStatus,
        refreshRemoteStatus,
        refreshRepoStatus,
        setRebuildDialogOpen,
        showError,
        showFeedback,
    ]);

    const handleFlowCommit = useCallback(async (mode: CommitMode) => {
        if (!groupId || !activeFlowPath) return;
        setCommitting(true);
        try {
            const committed = await commitCurrentFlow(commitMessage, mode);
            if (committed) {
                setFlowCommitDialogOpen(false);
                setCommitMessage('');
            }
        } finally {
            setCommitting(false);
        }
    }, [activeFlowPath, commitCurrentFlow, commitMessage, groupId]);

    const handleFlowCommitAndPush = useCallback(async (mode: CommitMode) => {
        if (!groupId || !activeFlowPath || committing || pushingFlow) return;
        setCommitting(true);
        let committed = false;
        try {
            committed = await commitCurrentFlow(commitMessage, mode);
            if (committed) {
                setFlowCommitDialogOpen(false);
                setCommitMessage('');
            }
        } finally {
            setCommitting(false);
        }
        if (committed) {
            await handleConfirmPushCurrentFlow();
        }
    }, [activeFlowPath, commitCurrentFlow, commitMessage, committing, groupId, handleConfirmPushCurrentFlow, pushingFlow]);

    const handleRepoCommit = useCallback(async (mode: CommitMode) => {
        if (!groupId) return;
        setCommitting(true);
        try {
            const committed = await commitRepository(commitMessage, {
                saveCurrentFlowBeforeCommit: mode === 'save-and-commit' && activeFlowPath && isDirty
                    ? () => flushDraftNow()
                    : undefined,
                afterCommit: refreshFlowCommitStatus,
            });
            if (committed) {
                setRepoCommitDialogOpen(false);
                setCommitMessage('');
            }
        } finally {
            setCommitting(false);
        }
    }, [groupId, activeFlowPath, commitMessage, isDirty, flushDraftNow, commitRepository, refreshFlowCommitStatus]);

    const handleOpenFlowCommitDialog = useCallback(() => {
        if (!groupId || !activeFlowPath || !flowDocument) return;
        const rollbackEntries = Object.entries(activeRollbackIssues);
        if (rollbackEntries.length > 0) {
            const [taskId, reason] = rollbackEntries[0];
            showFeedback({
                tone: 'error',
                title: '请先修复节点数据源配置',
                detail: `节点「${taskId}」${reason}`,
            });
            return;
        }
        if (!validateDocumentForAction()) return;
        setFlowCommitDialogOpen(true);
    }, [activeFlowPath, activeRollbackIssues, flowDocument, groupId, showFeedback, validateDocumentForAction]);

    const handleOpenRepoCommitDialog = useCallback(() => {
        if (!groupId) return;
        setRepoCommitDialogOpen(true);
    }, [groupId]);

    return {
        flowCommitDialogOpen,
        setFlowCommitDialogOpen,
        flowPushDialogOpen,
        setFlowPushDialogOpen,
        repoCommitDialogOpen,
        setRepoCommitDialogOpen,
        commitMessage,
        setCommitMessage,
        committing,
        pushingFlow,
        handleConfirmPushCurrentFlow,
        handleFlowCommit,
        handleFlowCommitAndPush,
        handleRepoCommit,
        handleOpenFlowCommitDialog,
        handleOpenRepoCommitDialog,
    };
}
