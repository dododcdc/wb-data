import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { AxiosError } from 'axios';
import { flushSync } from 'react-dom';
import type { Edge, Node } from '@xyflow/react';

import {
    commitOfflineCurrentFlow,
    getOfflineFlowCommitStatus,
    getOfflineFlowDocument,
    saveOfflineFlowDocument,
    type NodePosition,
    type OfflineFlowDocument,
    type OfflineFlowNode,
    type OfflineFlowNodeKind,
} from '../../api/offline';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../utils/error';
import {
    addFlowNode,
    applyFlowCanvasEdges,
    applyFlowCanvasLayout,
    applyFlowCanvasNodes,
    flattenFlowDocumentNodes,
    renameFlowNode,
    validateFlowDocumentGraph,
    type RenameFlowNodeFailureReason,
} from './flowDocumentMutations';
import {
    buildRecoverySnapshotFromSession,
    createFlowDraftSession,
    forceOverwriteRebase,
    flushNodeEditorDraft,
    hasFlowDraftChanges,
    prepareSessionForLeave,
    rebaseFlowDraftSession,
    replaceFlowDraftWorkingDocument,
    resolveDraftConflict,
    type FlowDraftSession,
    type PendingNodeEditorDraft,
} from './flowDraftController';
import { finalizeNodeEditorDraftOnClose } from './nodeEditorCloseDraftState';
import {
    findFirstNodeWithInvalidDataSource,
    validateSqlNodeDataSourceRequirement,
} from './nodeEditorDataSourceRules';
import { createNodeEditorDraftScheduler } from './nodeEditorDraftScheduler';
import { resolvePendingNodeEditorDraftAfterDocumentChange } from './pendingNodeEditorDraftState';
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
    refreshRepoStatus: () => Promise<void>;
    resetExecutionAndSchedule?: () => void;
}

export interface OpenFlowDocumentOptions {
    preferRecoverySnapshot?: boolean;
    force?: boolean;
    canLeaveDirty?: boolean;
    skipLeaveCurrent?: boolean;
}

interface PendingNodeOverrideForSave {
    taskId: string;
    content: string;
    dataSourceId?: number;
    dataSourceType?: string;
}

interface FlushPendingNodeEditorDraftForSaveResult {
    session: FlowDraftSession;
    nodeOverride?: PendingNodeOverrideForSave;
}

interface SaveConflictState {
    path: string;
    pendingSession: FlowDraftSession;
}

function buildCanvasNodesFromFlowDocument(document: OfflineFlowDocument): Node[] {
    return flattenFlowDocumentNodes(document).map((node, index) => {
        const position = document.layout?.[node.taskId] ?? { x: 250, y: index * 120 };

        return {
            id: node.taskId,
            type: 'flowNode',
            position: { ...position },
            data: {},
        };
    });
}

function buildCanvasEdgesFromFlowDocument(document: OfflineFlowDocument): Edge[] {
    return (document.edges ?? []).map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: 'default',
    }));
}

export function useFlowEditingSession(params: UseFlowEditingSessionParams) {
    const {
        groupId,
        loadScheduleSnapshot,
        showFeedback,
        refreshRepoStatus,
        resetExecutionAndSchedule,
    } = params;
    const [activeFlowPath, setActiveFlowPath] = useState<string | null>(null);
    const [flowLoading, setFlowLoading] = useState(false);
    const [draftSession, setDraftSession] = useState<FlowDraftSession | null>(null);
    const [nodeEditorOpen, setNodeEditorOpenState] = useState(false);
    const [nodeEditorContent, setNodeEditorContent] = useState('');
    const [savingFlow, setSavingFlow] = useState(false);
    const [flowCommitDirty, setFlowCommitDirty] = useState(false);
    const [saveConflictState, setSaveConflictState] = useState<SaveConflictState | null>(null);
    const [saveConflictPending, setSaveConflictPending] = useState(false);
    const currentGroupIdRef = useRef<number | null>(groupId);
    const groupActionVersionRef = useRef(0);
    const pendingNodeEditorDraftRef = useRef<PendingNodeEditorDraft | null>(null);
    const draftSessionRef = useRef<FlowDraftSession | null>(null);
    const activeFlowPathRef = useRef<string | null>(null);
    const canvasNodesRef = useRef<Node[]>([]);
    const canvasEdgesRef = useRef<Edge[]>([]);
    const nodeEditorDraftSchedulerRef = useRef<ReturnType<typeof createNodeEditorDraftScheduler> | null>(null);

    const setDraftSessionSync = useCallback((nextValue: SetStateAction<FlowDraftSession | null>) => {
        const nextSession = typeof nextValue === 'function'
            ? (nextValue as (current: FlowDraftSession | null) => FlowDraftSession | null)(draftSessionRef.current)
            : nextValue;
        draftSessionRef.current = nextSession;
        setDraftSession(nextSession);
        return nextSession;
    }, []);

    if (currentGroupIdRef.current !== groupId) {
        currentGroupIdRef.current = groupId;
        groupActionVersionRef.current += 1;
    }

    if (!nodeEditorDraftSchedulerRef.current) {
        nodeEditorDraftSchedulerRef.current = createNodeEditorDraftScheduler({
            delayMs: NODE_EDITOR_DRAFT_FLUSH_DELAY_MS,
            onFlush: (draft) => {
                setDraftSessionSync((current) => current
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

    useEffect(() => {
        activeFlowPathRef.current = activeFlowPath;
    }, [activeFlowPath]);

    useEffect(() => () => {
        nodeEditorDraftSchedulerRef.current?.cancel();
    }, []);

    const captureGroupActionGuard = useCallback((expectedGroupId: number | null) => {
        const version = groupActionVersionRef.current;
        return () => currentGroupIdRef.current === expectedGroupId && groupActionVersionRef.current === version;
    }, []);

    const setSelectedNodeId = useCallback((nextSelectedNodeId: string | null) => {
        setDraftSessionSync((current) => current ? { ...current, selectedNodeId: nextSelectedNodeId } : current);
    }, [setDraftSessionSync]);

    const setSelectedTaskIds = useCallback((nextValue: string[] | ((current: string[]) => string[])) => {
        setDraftSessionSync((current) => {
            if (!current) return current;
            const nextSelectedTaskIds = typeof nextValue === 'function' ? nextValue(current.selectedTaskIds) : nextValue;
            return {
                ...current,
                selectedTaskIds: [...nextSelectedTaskIds],
            };
        });
    }, [setDraftSessionSync]);

    const syncCanvasRefsFromDocument = useCallback((document: OfflineFlowDocument) => {
        canvasNodesRef.current = buildCanvasNodesFromFlowDocument(document);
        canvasEdgesRef.current = buildCanvasEdgesFromFlowDocument(document);
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
        syncCanvasRefsFromDocument(nextSession.workingDraft);
        setActiveFlowPath(path);
        setDraftSessionSync(nextSession);
    }, [groupId, setDraftSessionSync, syncCanvasRefsFromDocument]);

    const leaveCurrentFlow = useCallback((
        session?: FlowDraftSession | null,
        groupOverride: number | null = groupId,
    ) => {
        const sessionToLeave = session === undefined ? draftSessionRef.current : session;
        if (!groupOverride || !sessionToLeave) return null;
        nodeEditorDraftSchedulerRef.current?.cancel();
        const result = prepareSessionForLeave(sessionToLeave, pendingNodeEditorDraftRef.current, Date.now());
        setDraftSessionSync(result.nextSession);
        pendingNodeEditorDraftRef.current = null;
        if (result.snapshot) {
            writeRecoverySnapshot(groupOverride, sessionToLeave.path, result.snapshot);
        } else if (sessionToLeave.conflict) {
            writeRecoverySnapshot(groupOverride, sessionToLeave.path, sessionToLeave.conflict.snapshot);
        } else {
            removeRecoverySnapshot(groupOverride, sessionToLeave.path);
        }
        return result;
    }, [groupId, setDraftSessionSync]);

    const discardCurrentFlowDraft = useCallback((groupOverride: number | null = groupId) => {
        const sessionToDiscard = draftSessionRef.current;
        if (!groupOverride || !sessionToDiscard) return null;
        nodeEditorDraftSchedulerRef.current?.cancel();
        const result = prepareSessionForLeave(sessionToDiscard, pendingNodeEditorDraftRef.current, Date.now());
        setDraftSessionSync(result.nextSession);
        pendingNodeEditorDraftRef.current = null;
        removeRecoverySnapshot(groupOverride, sessionToDiscard.path);
        return result;
    }, [groupId, setDraftSessionSync]);

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
        canvasNodesRef.current = [];
        canvasEdgesRef.current = [];
        setActiveFlowPath(null);
        setFlowLoading(false);
        setDraftSessionSync(null);
        setNodeEditorOpenState(false);
        setNodeEditorContent('');
        setSavingFlow(false);
        setFlowCommitDirty(false);
        setSaveConflictState(null);
        setSaveConflictPending(false);
        resetExecutionAndSchedule?.();
    }, [resetExecutionAndSchedule, setDraftSessionSync]);

    const refreshCurrentFlowCommitStatus = useCallback(async () => {
        if (!groupId || !activeFlowPath) {
            setFlowCommitDirty(false);
            return;
        }
        const requestedGroupId = groupId;
        const requestedFlowPath = activeFlowPath;
        try {
            const result = await getOfflineFlowCommitStatus(requestedGroupId, requestedFlowPath);
            if (
                result.groupId === requestedGroupId
                && requestedGroupId === currentGroupIdRef.current
                && result.flowPath === activeFlowPathRef.current
            ) {
                setFlowCommitDirty(result.dirty);
            }
        } catch {
            if (requestedGroupId === currentGroupIdRef.current && requestedFlowPath === activeFlowPathRef.current) {
                setFlowCommitDirty(false);
            }
        }
    }, [activeFlowPath, groupId]);

    useEffect(() => {
        void refreshCurrentFlowCommitStatus();
    }, [refreshCurrentFlowCommitStatus]);

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

    const renameNode = useCallback((oldId: string, newId: string) => {
        let failureReason: RenameFlowNodeFailureReason | null = null;
        let nextDocument: OfflineFlowDocument | null = null;
        flushSync(() => {
            setDraftSessionSync((current) => {
                if (!current) return current;
                const result = renameFlowNode({
                    document: current.workingDraft,
                    oldId,
                    newId,
                    activeNodeId: current.selectedNodeId,
                    selectedTaskIds: current.selectedTaskIds,
                });
                if (!result.ok) {
                    failureReason = result.reason;
                    return current;
                }

                nextDocument = result.document;
                return {
                    ...replaceFlowDraftWorkingDocument(current, result.document),
                    selectedNodeId: result.nextActiveNodeId,
                    selectedTaskIds: result.nextSelectedTaskIds,
                };
            });
        });
        if (nextDocument) {
            syncCanvasRefsFromDocument(nextDocument);
        }

        if (failureReason === 'duplicate') {
            showFeedback({ tone: 'error', title: '重命名失败', detail: '已存在相同名称的节点。' });
        } else if (failureReason === 'invalid-format') {
            showFeedback({ tone: 'error', title: '重命名失败', detail: '节点名称仅支持字母、数字和下划线。' });
        }
    }, [setDraftSessionSync, showFeedback, syncCanvasRefsFromDocument]);

    const addNode = useCallback((kind: OfflineFlowNodeKind, position: NodePosition) => {
        let failureReason: 'max-nodes' | null = null;
        let nextDocument: OfflineFlowDocument | null = null;
        flushSync(() => {
            setDraftSessionSync((current) => {
                if (!current) return current;
                const result = addFlowNode({
                    document: current.workingDraft,
                    kind,
                    position,
                    selectedTaskIds: current.selectedTaskIds,
                    maxNodes: 20,
                });
                if (!result.ok) {
                    failureReason = result.reason;
                    return current;
                }

                nextDocument = result.document;
                return {
                    ...replaceFlowDraftWorkingDocument(current, result.document),
                    selectedNodeId: result.nextActiveNodeId,
                    selectedTaskIds: result.nextSelectedTaskIds,
                };
            });
        });
        if (nextDocument) {
            syncCanvasRefsFromDocument(nextDocument);
        }

        if (failureReason === 'max-nodes') {
            showFeedback({ tone: 'info', title: '节点数量已达上限', detail: '离线 Flow 最多支持 20 个节点，请精简流程设计。' });
        }
    }, [setDraftSessionSync, showFeedback, syncCanvasRefsFromDocument]);

    const updateCanvasNodes = useCallback((nodes: Node[]) => {
        const previousNodeIds = new Set(canvasNodesRef.current.map((node) => node.id));
        const nextNodeIds = new Set(nodes.map((node) => node.id));
        canvasNodesRef.current = nodes;
        const nodeSetChanged = previousNodeIds.size !== nextNodeIds.size
            || Array.from(previousNodeIds).some((nodeId) => !nextNodeIds.has(nodeId));
        if (!nodeSetChanged) {
            return;
        }

        const pendingDraft = pendingNodeEditorDraftRef.current;
        let nextPendingDraft = pendingDraft;
        let nextCanvasDocument: OfflineFlowDocument | null = null;
        const shouldResetNodeEditor = Boolean(pendingDraft && !nextNodeIds.has(pendingDraft.taskId));

        setDraftSessionSync((current) => {
            if (!current) {
                nextPendingDraft = null;
                return current;
            }

            const currentWithPending = pendingDraft
                ? flushNodeEditorDraft(current, pendingDraft)
                : current;
            const canvasResult = applyFlowCanvasNodes({
                document: currentWithPending.workingDraft,
                nodes,
                edges: canvasEdgesRef.current,
                activeNodeId: currentWithPending.selectedNodeId,
                selectedTaskIds: currentWithPending.selectedTaskIds,
            });
            const nextDocument = canvasResult.document;
            nextCanvasDocument = nextDocument;
            nextPendingDraft = resolvePendingNodeEditorDraftAfterDocumentChange(pendingDraft, nextDocument);

            return {
                ...replaceFlowDraftWorkingDocument(currentWithPending, nextDocument),
                selectedNodeId: canvasResult.nextActiveNodeId,
                selectedTaskIds: [...canvasResult.nextSelectedTaskIds],
            };
        });

        pendingNodeEditorDraftRef.current = nextPendingDraft;
        if (nextCanvasDocument) {
            canvasEdgesRef.current = buildCanvasEdgesFromFlowDocument(nextCanvasDocument);
        }
        if (shouldResetNodeEditor) {
            resetNodeEditorState();
        }
    }, [resetNodeEditorState, setDraftSessionSync]);

    const updateCanvasEdges = useCallback((edges: Edge[]) => {
        canvasEdgesRef.current = edges;
        let nextCanvasDocument: OfflineFlowDocument | null = null;
        setDraftSessionSync((current) => {
            if (!current) return current;
            const nextDocument = applyFlowCanvasEdges(current.workingDraft, edges);
            if (JSON.stringify(current.workingDraft.edges) === JSON.stringify(nextDocument.edges)) {
                return current;
            }
            nextCanvasDocument = nextDocument;
            return replaceFlowDraftWorkingDocument(current, nextDocument);
        });
        if (nextCanvasDocument) {
            canvasEdgesRef.current = buildCanvasEdgesFromFlowDocument(nextCanvasDocument);
        }
    }, [setDraftSessionSync]);

    const commitCanvasLayout = useCallback((nodes: Node[]) => {
        canvasNodesRef.current = nodes;
        let nextCanvasDocument: OfflineFlowDocument | null = null;
        setDraftSessionSync((current) => {
            if (!current) return current;
            const nextDocument = applyFlowCanvasLayout(current.workingDraft, nodes);
            if (JSON.stringify(current.workingDraft.layout) === JSON.stringify(nextDocument.layout)) {
                return current;
            }
            nextCanvasDocument = nextDocument;
            return replaceFlowDraftWorkingDocument(current, nextDocument);
        });
        if (nextCanvasDocument) {
            canvasNodesRef.current = buildCanvasNodesFromFlowDocument(nextCanvasDocument);
        }
    }, [setDraftSessionSync]);

    const flushPendingNodeEditorDraftForSave = useCallback((): FlushPendingNodeEditorDraftForSaveResult | null => {
        nodeEditorDraftSchedulerRef.current?.cancel();
        const currentSession = draftSessionRef.current;
        const pendingDraft = pendingNodeEditorDraftRef.current;
        if (!currentSession) {
            pendingNodeEditorDraftRef.current = null;
            return null;
        }

        if (!pendingDraft) {
            return { session: currentSession };
        }

        const nextSession = flushNodeEditorDraft(currentSession, pendingDraft);
        pendingNodeEditorDraftRef.current = null;
        setDraftSessionSync(nextSession);
        return {
            session: nextSession,
            nodeOverride: {
                taskId: pendingDraft.taskId,
                content: pendingDraft.scriptContent,
                dataSourceId: pendingDraft.dataSourceId,
                dataSourceType: pendingDraft.dataSourceType,
            },
        };
    }, [setDraftSessionSync]);

    const validateDocumentForAction = useCallback((nodeOverride?: PendingNodeOverrideForSave) => {
        const currentDocument = draftSessionRef.current?.workingDraft ?? null;
        if (!currentDocument) return true;

        const invalidNode = findFirstNodeWithInvalidDataSource(currentDocument, nodeOverride);
        if (invalidNode) {
            const validation = validateSqlNodeDataSourceRequirement({
                kind: invalidNode.kind,
                dataSourceId: invalidNode.dataSourceId,
                dataSourceType: invalidNode.dataSourceType,
                strict: true,
            });
            if (!validation.allowed && validation.feedback) {
                showFeedback(validation.feedback);
                return false;
            }
        }
        return true;
    }, [showFeedback]);

    const persistFlowSession = useCallback(async (sessionForSave: FlowDraftSession) => {
        if (!groupId) {
            throw new Error('Missing groupId');
        }
        const draftDocument = sessionForSave.workingDraft;
        return saveOfflineFlowDocument({
            groupId,
            path: sessionForSave.path,
            documentHash: sessionForSave.baseDocument.documentHash,
            documentUpdatedAt: sessionForSave.baseDocument.documentUpdatedAt,
            stages: draftDocument.stages.map((stage) => ({
                stageId: stage.stageId,
                nodes: stage.nodes.map((node) => ({
                    taskId: node.taskId,
                    scriptContent: node.scriptContent,
                    kind: node.kind,
                    scriptPath: node.scriptPath,
                    dataSourceId: node.dataSourceId,
                    dataSourceType: node.dataSourceType,
                })),
            })),
            edges: draftDocument.edges,
            layout: draftDocument.layout,
            schedule: draftDocument.schedule,
        });
    }, [groupId]);

    const saveFlow = useCallback(async (nodeOverride?: PendingNodeOverrideForSave, silent = false) => {
        const currentSession = draftSessionRef.current;
        if (!groupId || !activeFlowPath || !currentSession) return false;
        const pendingDraftForSave = flushPendingNodeEditorDraftForSave();
        const sessionForSaveBase = pendingDraftForSave?.session ?? currentSession;
        const effectiveNodeOverride = nodeOverride ?? pendingDraftForSave?.nodeOverride;

        if (!validateDocumentForAction(effectiveNodeOverride)) {
            return false;
        }
        const sessionForSave = effectiveNodeOverride
            ? flushNodeEditorDraft(sessionForSaveBase, {
                taskId: effectiveNodeOverride.taskId,
                scriptContent: effectiveNodeOverride.content,
                dataSourceId: effectiveNodeOverride.dataSourceId,
                dataSourceType: effectiveNodeOverride.dataSourceType,
            })
            : sessionForSaveBase;
        const draftDocument = sessionForSave.workingDraft;

        const graphValidation = validateFlowDocumentGraph(draftDocument);
        if (!graphValidation.valid) {
            showFeedback({
                tone: 'error',
                title: '保存失败',
                detail: graphValidation.reason === 'disconnected'
                    ? '画布中存在未连接的节点，请将所有节点连入一张依赖图。'
                    : '',
            });
            return false;
        }

        setSavingFlow(true);
        try {
            setDraftSessionSync(sessionForSave);

            const response = await persistFlowSession(sessionForSave);
            const nextSession = rebaseFlowDraftSession(sessionForSave, response);
            setDraftSessionSync(nextSession);
            removeRecoverySnapshot(groupId, sessionForSave.path);
            await Promise.all([refreshRepoStatus(), refreshCurrentFlowCommitStatus()]);
            if (!silent) {
                showFeedback({
                    tone: 'success',
                    title: 'Flow 已保存',
                    detail: '',
                });
            }
            return true;
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 409) {
                writeRecoverySnapshot(groupId, sessionForSave.path, buildRecoverySnapshotFromSession(sessionForSave, Date.now()));
                setSaveConflictState({
                    path: sessionForSave.path,
                    pendingSession: sessionForSave,
                });
                return false;
            }
            showFeedback({
                tone: 'error',
                title: '保存失败',
                detail: getErrorMessage(error, '本地脚本文件保存失败，请稍后重试。'),
            });
            return false;
        } finally {
            setSavingFlow(false);
        }
    }, [
        activeFlowPath,
        flushPendingNodeEditorDraftForSave,
        groupId,
        persistFlowSession,
        refreshCurrentFlowCommitStatus,
        refreshRepoStatus,
        setDraftSessionSync,
        showFeedback,
        validateDocumentForAction,
    ]);

    const commitCurrentFlow = useCallback(async (
        message: string,
        mode: 'save-and-commit' | 'saved-only',
    ) => {
        if (!groupId || !activeFlowPath) return false;
        try {
            const currentSession = draftSessionRef.current;
            const pendingDraft = pendingNodeEditorDraftRef.current;
            const pendingDraftChanged = Boolean(
                pendingDraft
                && currentSession
                && flattenFlowDocumentNodes(currentSession.workingDraft).some((node) => node.taskId === pendingDraft.taskId
                    && (
                        node.scriptContent !== pendingDraft.scriptContent
                        || node.dataSourceId !== pendingDraft.dataSourceId
                        || node.dataSourceType !== pendingDraft.dataSourceType
                    )),
            );
            if (
                mode === 'save-and-commit'
                && currentSession
                && (hasFlowDraftChanges(currentSession) || pendingDraftChanged)
            ) {
                const saved = await saveFlow(undefined, false);
                if (!saved) return false;
            }
            const result = await commitOfflineCurrentFlow(groupId, activeFlowPath, message);
            if (result.success) {
                await Promise.all([refreshRepoStatus(), refreshCurrentFlowCommitStatus()]);
                showFeedback({ tone: 'success', title: result.message, detail: '' });
            }
            return result.success;
        } catch {
            showFeedback({ tone: 'error', title: '当前 Flow 提交失败', detail: '' });
            return false;
        }
    }, [activeFlowPath, groupId, refreshCurrentFlowCommitStatus, refreshRepoStatus, saveFlow, showFeedback]);

    const restoreStaleDraft = useCallback(() => {
        if (!draftSessionRef.current?.conflict) return;
        setDraftSessionSync((current) => current ? resolveDraftConflict(current, 'restore-local') : current);
        showFeedback({
            tone: 'info',
            title: '已恢复旧草稿',
            detail: '',
        });
    }, [setDraftSessionSync, showFeedback]);

    const discardStaleDraft = useCallback(() => {
        if (!groupId || !activeFlowPath) return;
        removeRecoverySnapshot(groupId, activeFlowPath);
        setDraftSessionSync((current) => current ? resolveDraftConflict(current, 'load-server') : current);
        showFeedback({
            tone: 'info',
            title: '已丢弃本地草稿',
            detail: '',
        });
    }, [activeFlowPath, groupId, setDraftSessionSync, showFeedback]);

    const closeSaveConflict = useCallback(() => {
        if (saveConflictPending) return;
        setSaveConflictState(null);
    }, [saveConflictPending]);

    const discardSaveConflict = useCallback(async () => {
        if (!groupId || !saveConflictState) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setSaveConflictPending(true);
        try {
            const reloaded = await openFlowDocument(saveConflictState.path, { preferRecoverySnapshot: false });
            if (!isCurrentGroupAction()) return;
            if (!reloaded) return;
            removeRecoverySnapshot(groupId, saveConflictState.path);
            setSaveConflictState(null);
        } finally {
            if (isCurrentGroupAction()) {
                setSaveConflictPending(false);
            }
        }
    }, [captureGroupActionGuard, groupId, openFlowDocument, saveConflictState]);

    const overwriteSaveConflict = useCallback(async () => {
        if (!groupId || !saveConflictState) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setSaveConflictPending(true);
        try {
            const latest = await getOfflineFlowDocument(groupId, saveConflictState.path);
            if (!isCurrentGroupAction()) return;
            const rebasedSession = forceOverwriteRebase(saveConflictState.pendingSession, latest);
            writeRecoverySnapshot(groupId, rebasedSession.path, buildRecoverySnapshotFromSession(rebasedSession, Date.now()));
            setSaveConflictState({
                path: rebasedSession.path,
                pendingSession: rebasedSession,
            });
            setDraftSessionSync(rebasedSession);
            const response = await persistFlowSession(rebasedSession);
            if (!isCurrentGroupAction()) return;
            setDraftSessionSync(rebaseFlowDraftSession(rebasedSession, response));
            removeRecoverySnapshot(groupId, rebasedSession.path);
            setSaveConflictState(null);
            await Promise.all([refreshRepoStatus(), refreshCurrentFlowCommitStatus()]);
            if (!isCurrentGroupAction()) return;
            showFeedback({
                tone: 'success',
                title: 'Flow 已保存',
                detail: '',
            });
        } catch (error) {
            if (!isCurrentGroupAction()) return;
            const detail = error instanceof AxiosError && error.response?.status === 409
                ? '服务器版本再次发生变化，请确认后重试覆盖保存。'
                : getErrorMessage(error, '暂时无法基于最新版本覆盖保存，请稍后重试。');
            showFeedback({
                tone: 'error',
                title: '覆盖保存失败',
                detail,
            });
        } finally {
            if (isCurrentGroupAction()) {
                setSaveConflictPending(false);
            }
        }
    }, [
        captureGroupActionGuard,
        groupId,
        persistFlowSession,
        refreshCurrentFlowCommitStatus,
        refreshRepoStatus,
        saveConflictState,
        setDraftSessionSync,
        showFeedback,
    ]);

    return {
        activeFlowPath,
        setActiveFlowPath,
        flowLoading,
        draftSession,
        setDraftSession: setDraftSessionSync as Dispatch<SetStateAction<FlowDraftSession | null>>,
        nodeEditorOpen,
        nodeEditorContent,
        savingFlow,
        flowCommitDirty,
        saveConflictState,
        isSaveConflictPending: saveConflictPending,
        flowDocument,
        activeNodeId,
        selectedTaskIds,
        staleDraft,
        activeNode: activeNode as OfflineFlowNode | null,
        nodeCount,
        isDirty,
        canvasNodesRef,
        canvasEdgesRef,
        setSelectedNodeId,
        setSelectedTaskIds,
        applyFlowDocumentPayload,
        leaveCurrentFlow,
        discardCurrentFlowDraft,
        openFlowDocument,
        resetAfterBranchSwitch,
        openNodeEditor,
        setNodeEditorOpen,
        updateNodeEditorContent,
        stageNodeEditorDraft,
        saveNodeEditorDraft,
        resetNodeEditorState,
        cancelNodeEditorDraftFlush,
        renameNode,
        addNode,
        updateCanvasNodes,
        updateCanvasEdges,
        commitCanvasLayout,
        flushPendingNodeEditorDraftForSave,
        saveFlow,
        commitCurrentFlow,
        closeSaveConflict,
        discardSaveConflict,
        overwriteSaveConflict,
        restoreStaleDraft,
        discardStaleDraft,
        refreshFlowCommitStatus: refreshCurrentFlowCommitStatus,
    };
}
