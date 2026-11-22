import { useCallback, useEffect, useMemo, useState } from 'react';
import { rollbackOfflineFlow, type OfflineFlowDocument } from '../../../api/offline';
import type { FeedbackPayload } from '../../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../../utils/error';
import type { FlowDraftSession } from '../draft/flowDraftController';
import { filterActiveRollbackIssues } from '../draft/flowNodeIssues';
import type { VersionSelection } from './OfflineVersionCompareDialog';
import { buildWorktreeVersionSelection, formatRevisionTag } from './versionComparePresentation';

interface UseOfflineVersionWorkflowParams {
    groupId: number | null;
    activeFlowPath: string | null;
    flowDocument: OfflineFlowDocument | null;
    draftSession: FlowDraftSession | null;
    canWrite: boolean;
    savingFlow: boolean;
    isDirty: boolean;
    flowCommitDirty: boolean;
    flushPendingDraftIfDirty: () => Promise<boolean>;
    applyFlowDocumentPayload: (
        path: string,
        payload: OfflineFlowDocument,
        options?: { preferRecoverySnapshot?: boolean },
    ) => void;
    loadScheduleSnapshot: (path: string) => Promise<void>;
    refreshRepoStatus: () => Promise<void>;
    refreshFlowCommitStatus: () => Promise<void>;
    onSwitchToDevMode: () => void;
    showFeedback: (payload: FeedbackPayload) => void;
    showSuccess: (title: string, detail?: string) => void;
}

export function useOfflineVersionWorkflow({
    groupId,
    activeFlowPath,
    flowDocument,
    draftSession,
    canWrite,
    savingFlow,
    isDirty,
    flowCommitDirty,
    flushPendingDraftIfDirty,
    applyFlowDocumentPayload,
    loadScheduleSnapshot,
    refreshRepoStatus,
    refreshFlowCommitStatus,
    onSwitchToDevMode,
    showFeedback,
    showSuccess,
}: UseOfflineVersionWorkflowParams) {
    const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
    const [versionCompare, setVersionCompare] = useState<{
        base: VersionSelection;
        target: VersionSelection;
        open: boolean;
    } | null>(null);
    const [rollbackTarget, setRollbackTarget] = useState<VersionSelection | null>(null);
    const [rollingBack, setRollingBack] = useState(false);
    const [rollbackNodeIssues, setRollbackNodeIssues] = useState<Record<string, string>>({});

    useEffect(() => {
        setRollbackNodeIssues({});
        setRollbackTarget(null);
    }, [groupId, activeFlowPath]);

    const activeRollbackIssues = useMemo(
        () => filterActiveRollbackIssues(flowDocument, rollbackNodeIssues),
        [flowDocument, rollbackNodeIssues],
    );

    const clearRollbackNodeIssue = useCallback((taskId: string) => {
        setRollbackNodeIssues((current) => {
            if (!(taskId in current)) return current;
            const next = { ...current };
            delete next[taskId];
            return next;
        });
    }, []);

    const ensureWorktreeFlushed = useCallback(async (): Promise<boolean> => {
        if (!canWrite) return true;
        return flushPendingDraftIfDirty();
    }, [canWrite, flushPendingDraftIfDirty]);

    const handleCompareVersions = useCallback(async (base: VersionSelection, target: VersionSelection) => {
        if ((base.revision === 'WORKTREE' || target.revision === 'WORKTREE') && !(await ensureWorktreeFlushed())) {
            return;
        }
        setVersionHistoryOpen(false);
        setVersionCompare({ base, target, open: true });
    }, [ensureWorktreeFlushed]);

    const handleConfirmRollback = useCallback(async () => {
        if (!groupId || !activeFlowPath || !rollbackTarget || rollingBack || savingFlow) return;
        const target = rollbackTarget;
        const targetPath = activeFlowPath;
        const targetGroupId = groupId;
        setRollingBack(true);
        try {
            const response = await rollbackOfflineFlow({
                groupId: targetGroupId,
                path: targetPath,
                revision: target.revision,
                documentHash: draftSession?.baseDocument?.documentHash,
                documentUpdatedAt: draftSession?.baseDocument?.documentUpdatedAt,
            });
            applyFlowDocumentPayload(targetPath, response.document, { preferRecoverySnapshot: false });
            setRollbackNodeIssues(response.nodeIssues ?? {});
            onSwitchToDevMode();
            setRollbackTarget(null);
            setVersionHistoryOpen(false);
            setVersionCompare(null);
            await Promise.all([
                loadScheduleSnapshot(targetPath),
                refreshRepoStatus(),
                refreshFlowCommitStatus(),
            ]);
            const shortSha = target.shortRevision?.trim() || formatRevisionTag(target.revision);
            if (response.warnings?.length) {
                showFeedback({
                    tone: 'info',
                    title: `已回滚到版本 ${shortSha}（含 ${response.warnings.length} 项兼容提示）`,
                    detail: response.warnings.join('；'),
                });
            } else {
                showSuccess(`已回滚到版本 ${shortSha}`, '仅更新当前工作区草稿，确认无误后再提交和推送');
            }
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '版本回滚失败',
                detail: getErrorMessage(error, ''),
            });
        } finally {
            setRollingBack(false);
        }
    }, [
        activeFlowPath,
        applyFlowDocumentPayload,
        draftSession?.baseDocument?.documentHash,
        draftSession?.baseDocument?.documentUpdatedAt,
        groupId,
        loadScheduleSnapshot,
        onSwitchToDevMode,
        refreshFlowCommitStatus,
        refreshRepoStatus,
        rollbackTarget,
        rollingBack,
        savingFlow,
        showFeedback,
        showSuccess,
    ]);

    const handleCompareRollbackWithWorktree = useCallback(() => {
        if (!rollbackTarget) return;
        const target = rollbackTarget;
        setRollbackTarget(null);
        void handleCompareVersions(target, buildWorktreeVersionSelection({ dirty: isDirty || flowCommitDirty }));
    }, [flowCommitDirty, handleCompareVersions, isDirty, rollbackTarget]);

    return {
        versionHistoryOpen,
        setVersionHistoryOpen,
        versionCompare,
        setVersionCompare,
        rollbackTarget,
        setRollbackTarget,
        rollingBack,
        activeRollbackIssues,
        clearRollbackNodeIssue,
        ensureWorktreeFlushed,
        handleCompareVersions,
        handleConfirmRollback,
        handleCompareRollbackWithWorktree,
    };
}
