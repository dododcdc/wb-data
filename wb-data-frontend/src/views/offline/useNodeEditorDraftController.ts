import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type SetStateAction,
} from 'react';

import type { OfflineFlowDocument } from '../../api/offline';
import { flattenFlowDocumentNodes } from './flowDocumentMutations';
import {
    flushNodeEditorDraft,
    type FlowDraftSession,
    type PendingNodeEditorDraft,
} from './flowDraftController';
import { finalizeNodeEditorDraftOnClose } from './nodeEditorCloseDraftState';
import { createNodeEditorDraftScheduler } from './nodeEditorDraftScheduler';

const NODE_EDITOR_DRAFT_FLUSH_DELAY_MS = 180;

type SetDraftSessionSync = (nextValue: SetStateAction<FlowDraftSession | null>) => FlowDraftSession | null;

interface UseNodeEditorDraftControllerParams {
    flowDocument: OfflineFlowDocument | null;
    activeNodeId: string | null;
    setSelectedNodeId: (nextSelectedNodeId: string | null) => void;
    setDraftSessionSync: SetDraftSessionSync;
}

export function useNodeEditorDraftController({
    flowDocument,
    activeNodeId,
    setSelectedNodeId,
    setDraftSessionSync,
}: UseNodeEditorDraftControllerParams) {
    const [nodeEditorOpen, setNodeEditorOpenState] = useState(false);
    const [nodeEditorContent, setNodeEditorContent] = useState('');
    const pendingNodeEditorDraftRef = useRef<PendingNodeEditorDraft | null>(null);
    const nodeEditorDraftSchedulerRef = useRef<ReturnType<typeof createNodeEditorDraftScheduler> | null>(null);

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

    useEffect(() => () => {
        nodeEditorDraftSchedulerRef.current?.cancel();
    }, []);

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

    const clearPendingNodeEditorDraft = useCallback(() => {
        pendingNodeEditorDraftRef.current = null;
    }, []);

    return {
        nodeEditorOpen,
        nodeEditorContent,
        pendingNodeEditorDraftRef,
        openNodeEditor,
        setNodeEditorOpen,
        updateNodeEditorContent,
        stageNodeEditorDraft,
        saveNodeEditorDraft,
        resetNodeEditorState,
        cancelNodeEditorDraftFlush,
        clearPendingNodeEditorDraft,
    };
}
