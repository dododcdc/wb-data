import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getOfflineRepoRemote,
    getOfflineRepoStatus,
    pushOfflineRepo,
    rebuildOfflineRepo,
    type OfflineRepoStatus,
    type RemoteStatus,
} from '../../api/offline';
import { getErrorMessage } from '../../utils/error';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';

interface UseOfflineRepositoryWorkflowParams {
    groupId: number | null;
    showFeedback: (payload: FeedbackPayload) => void;
}

export function useOfflineRepositoryWorkflow({
    groupId,
    showFeedback,
}: UseOfflineRepositoryWorkflowParams) {
    const [repoStatus, setRepoStatus] = useState<OfflineRepoStatus | null>(null);
    const [repoLoading, setRepoLoading] = useState(false);
    const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
    const [pushLoading, setPushLoading] = useState(false);
    const [pushDialogOpen, setPushDialogOpen] = useState(false);
    const [rebuildLoading, setRebuildLoading] = useState(false);
    const [rebuildDialogOpen, setRebuildDialogOpen] = useState(false);
    const groupIdRef = useRef(groupId);
    const actionVersionRef = useRef(0);

    useEffect(() => {
        if (groupIdRef.current !== groupId) {
            groupIdRef.current = groupId;
            actionVersionRef.current += 1;
            setRepoStatus(null);
            setRemoteStatus(null);
            setPushDialogOpen(false);
            setRebuildDialogOpen(false);
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
        pushLoading,
        pushDialogOpen,
        setPushDialogOpen,
        rebuildLoading,
        rebuildDialogOpen,
        setRebuildDialogOpen,
        refreshRepoStatus,
        refreshRemoteStatus,
        push,
        rebuildRemote,
    };
}
