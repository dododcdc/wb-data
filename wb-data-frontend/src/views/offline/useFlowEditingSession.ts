import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';

import {
    getOfflineFlowDocument,
    type OfflineFlowDocument,
    type OfflineFlowNode,
} from '../../api/offline';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../utils/error';
import { flattenFlowDocumentNodes } from './flowDocumentMutations';
import {
    createFlowDraftSession,
    flushNodeEditorDraft,
    hasFlowDraftChanges,
    prepareSessionForLeave,
    type FlowDraftSession,
    type PendingNodeEditorDraft,
} from './flowDraftController';
import { finalizeNodeEditorDraftOnClose } from './nodeEditorCloseDraftState';
import { createNodeEditorDraftScheduler } from './nodeEditorDraftScheduler';
import {
    readRecoverySnapshot,
    removeRecoverySnapshot,
    writeRecoverySnapshot,
} from './recoverySnapshotStore';

const EMPTY_SELECTED_TASK_IDS: string[] = [];
const NODE_EDITOR_DRAFT_FLUSH_DELAY_MS = 180;

export interface UseFlowEditingSessionParams {
    groupId: number | null;
    loadScheduleSnapshot: (path: string) => Promise<void>;
    showFeedback: (payload: FeedbackPayload) => void;
    resetExecutionAndSchedule?: () => void;
}

export interface OpenFlowDocumentOptions {
    preferRecoverySnapshot?: boolean;
    force?: boolean;
    canLeaveDirty?: boolean;
    skipLeaveCurrent?: boolean;
}

export function useFlowEditingSession(params: UseFlowEditingSessionParams) {
    const {
        groupId,
        loadScheduleSnapshot,
        showFeedback,
        resetExecutionAndSchedule,
    } = params;
    const [activeFlowPath, setActiveFlowPath] = useState<string | null>(null);
    const [flowLoading, setFlowLoading] = useState(false);
    const [draftSession, setDraftSession] = useState<FlowDraftSession | null>(null);
    const [nodeEditorOpen, setNodeEditorOpenState] = useState(false);
    const [nodeEditorContent, setNodeEditorContent] = useState('');
    const currentGroupIdRef = useRef<number | null>(groupId);
    const groupActionVersionRef = useRef(0);
    const pendingNodeEditorDraftRef = useRef<PendingNodeEditorDraft | null>(null);
    const draftSessionRef = useRef<FlowDraftSession | null>(null);
    const nodeEditorDraftSchedulerRef = useRef<ReturnType<typeof createNodeEditorDraftScheduler> | null>(null);

    if (currentGroupIdRef.current !== groupId) {
        currentGroupIdRef.current = groupId;
        groupActionVersionRef.current += 1;
    }

    if (!nodeEditorDraftSchedulerRef.current) {
        nodeEditorDraftSchedulerRef.current = createNodeEditorDraftScheduler({
            delayMs: NODE_EDITOR_DRAFT_FLUSH_DELAY_MS,
            onFlush: (draft) => {
                setDraftSession((current) => current
                    ? flushNodeEditorDraft(current, draft)
                    : current);
            },
        });
    }

    const flowDocument = draftSession?.workingDraft ?? null;
    const activeNodeId = draftSession?.selectedNodeId ?? null;
    const selectedTaskIds = draftSession?.selectedTaskIds ?? EMPTY_SELECTED_TASK_IDS;
    const staleDraft = draftSession?.conflict ?? null;
    const activeNode = useMemo(
        () => flattenFlowDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null,
        [activeNodeId, flowDocument],
    );
    const nodeCount = useMemo(() => flattenFlowDocumentNodes(flowDocument).length, [flowDocument]);
    const isDirty = draftSession !== null && hasFlowDraftChanges(draftSession);

    useEffect(() => {
        draftSessionRef.current = draftSession;
    }, [draftSession]);

    useEffect(() => () => {
        nodeEditorDraftSchedulerRef.current?.cancel();
    }, []);

    const captureGroupActionGuard = useCallback((expectedGroupId: number | null) => {
        const version = groupActionVersionRef.current;
        return () => currentGroupIdRef.current === expectedGroupId && groupActionVersionRef.current === version;
    }, []);

    const setSelectedNodeId = useCallback((nextSelectedNodeId: string | null) => {
        setDraftSession((current) => current ? { ...current, selectedNodeId: nextSelectedNodeId } : current);
    }, []);

    const setSelectedTaskIds = useCallback((nextValue: string[] | ((current: string[]) => string[])) => {
        setDraftSession((current) => {
            if (!current) return current;
            const nextSelectedTaskIds = typeof nextValue === 'function' ? nextValue(current.selectedTaskIds) : nextValue;
            return {
                ...current,
                selectedTaskIds: [...nextSelectedTaskIds],
            };
        });
    }, []);

    const applyFlowDocumentPayload = useCallback((
        path: string,
        payload: OfflineFlowDocument,
        options?: { preferRecoverySnapshot?: boolean },
    ) => {
        const snapshot = groupId && (options?.preferRecoverySnapshot ?? true)
            ? readRecoverySnapshot(groupId, path)
            : null;
        const nextSession = createFlowDraftSession({
            path,
            serverDocument: payload,
            snapshot,
        });
        pendingNodeEditorDraftRef.current = null;
        setActiveFlowPath(path);
        setDraftSession(nextSession);
    }, [groupId]);

    const leaveCurrentFlow = useCallback((
        session?: FlowDraftSession | null,
        groupOverride: number | null = groupId,
    ) => {
        const sessionToLeave = session === undefined ? draftSessionRef.current : session;
        if (!groupOverride || !sessionToLeave) return null;
        nodeEditorDraftSchedulerRef.current?.cancel();
        const result = prepareSessionForLeave(sessionToLeave, pendingNodeEditorDraftRef.current, Date.now());
        setDraftSession(result.nextSession);
        pendingNodeEditorDraftRef.current = null;
        if (result.snapshot) {
            writeRecoverySnapshot(groupOverride, sessionToLeave.path, result.snapshot);
        } else if (sessionToLeave.conflict) {
            writeRecoverySnapshot(groupOverride, sessionToLeave.path, sessionToLeave.conflict.snapshot);
        } else {
            removeRecoverySnapshot(groupOverride, sessionToLeave.path);
        }
        return result;
    }, [groupId]);

    const openFlowDocument = useCallback(async (pathValue: string, options?: OpenFlowDocumentOptions) => {
        if (!groupId) return false;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        const normalizedPath = pathValue.trim();
        let didApplyFlowDocument = false;
        if (!normalizedPath) {
            return false;
        }

        const currentSession = draftSessionRef.current;
        if (!options?.skipLeaveCurrent && currentSession && currentSession.path !== normalizedPath) {
            if (!options?.force && !options?.canLeaveDirty && hasFlowDraftChanges(currentSession)) {
                return false;
            }
            leaveCurrentFlow(currentSession);
        }

        setFlowLoading(true);
        try {
            const payload = await getOfflineFlowDocument(groupId, normalizedPath);
            if (!isCurrentGroupAction()) return false;
            applyFlowDocumentPayload(normalizedPath, payload, options);
            didApplyFlowDocument = true;
            await loadScheduleSnapshot(normalizedPath);
            if (!isCurrentGroupAction()) return false;
            return true;
        } catch (error) {
            if (!isCurrentGroupAction()) return false;
            if (didApplyFlowDocument) {
                return true;
            }
            showFeedback({
                tone: 'error',
                title: 'Flow 打开失败',
                detail: getErrorMessage(error, '请检查路径是否存在，或稍后再试。'),
            });
            return false;
        } finally {
            if (isCurrentGroupAction()) {
                setFlowLoading(false);
            }
        }
    }, [
        applyFlowDocumentPayload,
        captureGroupActionGuard,
        groupId,
        leaveCurrentFlow,
        loadScheduleSnapshot,
        showFeedback,
    ]);

    const resetAfterBranchSwitch = useCallback(() => {
        nodeEditorDraftSchedulerRef.current?.cancel();
        pendingNodeEditorDraftRef.current = null;
        setActiveFlowPath(null);
        setFlowLoading(false);
        setDraftSession(null);
        setNodeEditorOpenState(false);
        setNodeEditorContent('');
        resetExecutionAndSchedule?.();
    }, [resetExecutionAndSchedule]);

    const buildPendingNodeEditorDraft = useCallback((
        taskId: string,
        scriptContent: string,
        dataSourceId?: number,
        dataSourceType?: string,
    ): PendingNodeEditorDraft => ({
        taskId,
        scriptContent,
        ...(dataSourceId !== undefined ? { dataSourceId } : {}),
        ...(dataSourceType !== undefined ? { dataSourceType } : {}),
    }), []);

    const openNodeEditor = useCallback((taskId: string) => {
        const node = flattenFlowDocumentNodes(flowDocument).find((n) => n.taskId === taskId);
        if (!node) return;
        nodeEditorDraftSchedulerRef.current?.cancel();
        setSelectedNodeId(taskId);
        setNodeEditorContent(node.scriptContent);
        pendingNodeEditorDraftRef.current = buildPendingNodeEditorDraft(
            taskId,
            node.scriptContent,
            node.dataSourceId,
            node.dataSourceType,
        );
        setNodeEditorOpenState(true);
    }, [buildPendingNodeEditorDraft, flowDocument, setSelectedNodeId]);

    const setNodeEditorOpen = useCallback((open: boolean) => {
        setNodeEditorOpenState(open);
        if (!open) {
            pendingNodeEditorDraftRef.current = finalizeNodeEditorDraftOnClose({
                pendingDraft: pendingNodeEditorDraftRef.current,
                flushNow: (draft) => nodeEditorDraftSchedulerRef.current?.flushNow(draft),
                cancel: () => nodeEditorDraftSchedulerRef.current?.cancel(),
            });
            const currentNode = flattenFlowDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
            setNodeEditorContent(currentNode?.scriptContent ?? '');
        }
    }, [activeNodeId, flowDocument]);

    const stageNodeEditorDraft = useCallback((
        content: string,
        dataSourceId?: number,
        dataSourceType?: string,
    ) => {
        const taskId = activeNodeId ?? pendingNodeEditorDraftRef.current?.taskId;
        if (!taskId) return null;
        const pendingDraft = buildPendingNodeEditorDraft(taskId, content, dataSourceId, dataSourceType);
        pendingNodeEditorDraftRef.current = pendingDraft;
        nodeEditorDraftSchedulerRef.current?.flushNow(pendingDraft);
        return pendingDraft;
    }, [activeNodeId, buildPendingNodeEditorDraft]);

    const updateNodeEditorContent = useCallback((content: string) => {
        setNodeEditorContent(content);
        const currentPending = pendingNodeEditorDraftRef.current;
        const taskId = activeNodeId ?? currentPending?.taskId;
        if (!taskId) return;
        const pendingDraft = buildPendingNodeEditorDraft(
            taskId,
            content,
            currentPending?.dataSourceId,
            currentPending?.dataSourceType,
        );
        pendingNodeEditorDraftRef.current = pendingDraft;
        nodeEditorDraftSchedulerRef.current?.schedule(pendingDraft);
    }, [activeNodeId, buildPendingNodeEditorDraft]);

    const saveNodeEditorDraft = useCallback((
        content: string,
        dataSourceId?: number,
        dataSourceType?: string,
    ) => {
        const pendingDraft = stageNodeEditorDraft(content, dataSourceId, dataSourceType);
        setNodeEditorOpen(false);
        return pendingDraft;
    }, [setNodeEditorOpen, stageNodeEditorDraft]);

    const resetNodeEditorState = useCallback(() => {
        nodeEditorDraftSchedulerRef.current?.cancel();
        pendingNodeEditorDraftRef.current = null;
        setNodeEditorOpenState(false);
        setNodeEditorContent('');
    }, []);

    const cancelNodeEditorDraftFlush = useCallback(() => {
        nodeEditorDraftSchedulerRef.current?.cancel();
    }, []);

    return {
        activeFlowPath,
        setActiveFlowPath,
        flowLoading,
        draftSession,
        setDraftSession: setDraftSession as Dispatch<SetStateAction<FlowDraftSession | null>>,
        nodeEditorOpen,
        nodeEditorContent,
        flowDocument,
        activeNodeId,
        selectedTaskIds,
        staleDraft,
        activeNode: activeNode as OfflineFlowNode | null,
        nodeCount,
        isDirty,
        pendingNodeEditorDraftRef,
        draftSessionRef,
        setSelectedNodeId,
        setSelectedTaskIds,
        applyFlowDocumentPayload,
        leaveCurrentFlow,
        openFlowDocument,
        resetAfterBranchSwitch,
        openNodeEditor,
        setNodeEditorOpen,
        updateNodeEditorContent,
        stageNodeEditorDraft,
        saveNodeEditorDraft,
        resetNodeEditorState,
        cancelNodeEditorDraftFlush,
    };
}
