import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OfflineScheduleResponse } from '../../../api/offline';
import { flattenFlowDocumentNodes } from '../draft/flowDocumentMutations';
import { useOnlineFlowSnapshot, type CanvasMode } from './useOnlineFlowSnapshot';

interface UseOfflineOnlineModeParams {
    groupId: number | null;
    branch: string | null;
    activeFlowPath: string | null;
    defaultTimezone: string;
}

export function useOfflineOnlineMode({
    groupId,
    branch,
    activeFlowPath,
    defaultTimezone,
}: UseOfflineOnlineModeParams) {
    const [canvasMode, setCanvasMode] = useState<CanvasMode>('dev');
    const [onlineActiveNodeId, setOnlineActiveNodeId] = useState<string | null>(null);
    const [onlineNodeEditorOpen, setOnlineNodeEditorOpen] = useState(false);
    const [onlineScheduleDialogOpen, setOnlineScheduleDialogOpen] = useState(false);
    const [onlineDependencyDialogOpen, setOnlineDependencyDialogOpen] = useState(false);
    const [onlineParameterDialogOpen, setOnlineParameterDialogOpen] = useState(false);

    useEffect(() => {
        setOnlineActiveNodeId(null);
        setOnlineNodeEditorOpen(false);
        setOnlineScheduleDialogOpen(false);
        setOnlineDependencyDialogOpen(false);
        setOnlineParameterDialogOpen(false);
    }, [groupId, activeFlowPath]);

    useEffect(() => {
        setCanvasMode('dev');
    }, [groupId]);

    const {
        deploymentConfig,
        confirmedRevision,
        status: onlineStatus,
        snapshot: onlineSnapshot,
        onlineDocument,
        error: onlineError,
        refresh: refreshOnlineSnapshot,
        refreshDeployment,
    } = useOnlineFlowSnapshot({
        groupId,
        branch,
        activeFlowPath,
        enabled: canvasMode === 'online',
    });

    const onlineActiveNode = useMemo(() => {
        if (!onlineDocument || !onlineActiveNodeId) return null;
        return flattenFlowDocumentNodes(onlineDocument).find((node) => node.taskId === onlineActiveNodeId) ?? null;
    }, [onlineActiveNodeId, onlineDocument]);

    const onlineNodeContent = useMemo(() => {
        if (!onlineActiveNode) return '';
        if (onlineActiveNode.scriptContent !== undefined) return onlineActiveNode.scriptContent;
        if (onlineActiveNode.scriptPath && onlineSnapshot?.files) {
            const file = onlineSnapshot.files.find((item) => item.path === onlineActiveNode.scriptPath);
            if (file?.content != null) return file.content;
        }
        return '';
    }, [onlineActiveNode, onlineSnapshot]);

    const onlineScheduleResponse: OfflineScheduleResponse | null = useMemo(() => {
        if (!onlineDocument?.schedule || !groupId) return null;
        return {
            groupId,
            path: onlineDocument.path,
            triggerId: 'schedule',
            cron: onlineDocument.schedule.cron,
            timezone: onlineDocument.schedule.timezone,
            enabled: onlineDocument.schedule.enabled,
            period: onlineDocument.schedule.period,
            retryEnabled: Boolean(onlineDocument.schedule.retryEnabled),
            retryCount: onlineDocument.schedule.retryEnabled ? (onlineDocument.schedule.retryCount ?? null) : null,
            retryIntervalMinutes: onlineDocument.schedule.retryEnabled ? (onlineDocument.schedule.retryIntervalMinutes ?? null) : null,
            contentHash: '',
            fileUpdatedAt: 0,
        };
    }, [groupId, onlineDocument]);

    const handleCanvasModeChange = useCallback((nextMode: CanvasMode, onEnterOnline?: () => void) => {
        setCanvasMode(nextMode);
        if (nextMode === 'online') {
            onEnterOnline?.();
        } else {
            setOnlineScheduleDialogOpen(false);
            setOnlineDependencyDialogOpen(false);
            setOnlineParameterDialogOpen(false);
            setOnlineNodeEditorOpen(false);
        }
    }, []);

    const handleOpenOnlineNodeEditor = useCallback((taskId: string) => {
        setOnlineActiveNodeId(taskId);
        setOnlineNodeEditorOpen(true);
    }, []);

    return {
        canvasMode,
        setCanvasMode,
        onlineActiveNodeId,
        setOnlineActiveNodeId,
        onlineNodeEditorOpen,
        setOnlineNodeEditorOpen,
        onlineScheduleDialogOpen,
        setOnlineScheduleDialogOpen,
        onlineDependencyDialogOpen,
        setOnlineDependencyDialogOpen,
        onlineParameterDialogOpen,
        setOnlineParameterDialogOpen,
        deploymentConfig,
        confirmedRevision,
        onlineStatus,
        onlineDocument,
        onlineError,
        onlineActiveNode,
        onlineNodeContent,
        onlineScheduleResponse,
        defaultTimezone,
        refreshOnlineSnapshot,
        refreshDeployment,
        handleCanvasModeChange,
        handleOpenOnlineNodeEditor,
    };
}
