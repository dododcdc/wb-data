import { AxiosError } from 'axios';

import type { SaveOfflineFlowDocumentRequest } from '../../api/offline';
import { flattenFlowDocumentNodes } from './flowDocumentMutations';
import {
    flushNodeEditorDraft,
    type FlowDraftSession,
    type PendingNodeEditorDraft,
} from './flowDraftController';

export interface PendingNodeOverrideForSave {
    taskId: string;
    content: string;
    dataSourceId?: number;
    dataSourceType?: string;
}

interface PreparedFlowSessionForSave {
    sessionAfterPendingDraft: FlowDraftSession;
    sessionForSave: FlowDraftSession;
    nodeOverride?: PendingNodeOverrideForSave;
}

function toNodeOverride(draft: PendingNodeEditorDraft): PendingNodeOverrideForSave {
    return {
        taskId: draft.taskId,
        content: draft.scriptContent,
        dataSourceId: draft.dataSourceId,
        dataSourceType: draft.dataSourceType,
    };
}

function toPendingDraft(override: PendingNodeOverrideForSave): PendingNodeEditorDraft {
    return {
        taskId: override.taskId,
        scriptContent: override.content,
        dataSourceId: override.dataSourceId,
        dataSourceType: override.dataSourceType,
    };
}

export function prepareFlowSessionForSave(args: {
    session: FlowDraftSession;
    pendingDraft: PendingNodeEditorDraft | null;
    nodeOverride?: PendingNodeOverrideForSave;
}): PreparedFlowSessionForSave {
    const { session, pendingDraft, nodeOverride } = args;
    const sessionAfterPendingDraft = pendingDraft
        ? flushNodeEditorDraft(session, pendingDraft)
        : session;
    const effectiveNodeOverride = nodeOverride ?? (pendingDraft ? toNodeOverride(pendingDraft) : undefined);
    const sessionForSave = effectiveNodeOverride
        ? flushNodeEditorDraft(sessionAfterPendingDraft, toPendingDraft(effectiveNodeOverride))
        : sessionAfterPendingDraft;

    return {
        sessionAfterPendingDraft,
        sessionForSave,
        nodeOverride: effectiveNodeOverride,
    };
}

export function buildSaveFlowDocumentRequest(
    groupId: number,
    session: FlowDraftSession,
): SaveOfflineFlowDocumentRequest {
    const draftDocument = session.workingDraft;

    return {
        groupId,
        path: session.path,
        documentHash: session.baseDocument.documentHash,
        documentUpdatedAt: session.baseDocument.documentUpdatedAt,
        stages: draftDocument.stages.map((stage) => ({
            stageId: stage.stageId,
            nodes: stage.nodes.map((node) => ({
                taskId: node.taskId,
                scriptContent: node.scriptContent,
                kind: node.kind,
                scriptPath: node.scriptPath,
                dataSourceId: node.dataSourceId,
                dataSourceType: node.dataSourceType,
                transfer: node.transfer,
            })),
        })),
        edges: draftDocument.edges,
        layout: draftDocument.layout,
        schedule: draftDocument.schedule,
    };
}

export function hasPendingNodeEditorDraftChanges(
    session: FlowDraftSession | null,
    pendingDraft: PendingNodeEditorDraft | null,
) {
    return Boolean(
        pendingDraft
        && session
        && flattenFlowDocumentNodes(session.workingDraft).some((node) => node.taskId === pendingDraft.taskId
            && (
                node.scriptContent !== pendingDraft.scriptContent
                || node.dataSourceId !== pendingDraft.dataSourceId
                || node.dataSourceType !== pendingDraft.dataSourceType
            )),
    );
}

export function isSaveConflictError(error: unknown) {
    return error instanceof AxiosError && error.response?.status === 409;
}
