import { AxiosError } from 'axios';

import type { SaveOfflineFlowDocumentRequest } from '../../api/offline';
import type { TransferConfig } from './transfer/transferTypes';
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
    transfer?: TransferConfig;
    transferDraft?: TransferConfig;
    transferDraftValid?: boolean;
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
        transfer: draft.transfer,
        transferDraft: draft.transferDraft,
        transferDraftValid: draft.transferDraftValid,
    };
}

function toPendingDraft(override: PendingNodeOverrideForSave): PendingNodeEditorDraft {
    return {
        taskId: override.taskId,
        scriptContent: override.content,
        dataSourceId: override.dataSourceId,
        dataSourceType: override.dataSourceType,
        transfer: override.transfer,
        transferDraft: override.transferDraft,
        transferDraftValid: override.transferDraftValid,
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
                || JSON.stringify(node.transfer) !== JSON.stringify(pendingDraft.transfer)
                || JSON.stringify(node.transferDraft) !== JSON.stringify(pendingDraft.transferDraft)
                || node.transferDraftValid !== pendingDraft.transferDraftValid
            )),
    );
}

export function findFirstNodeWithInvalidTransferEditorDraft(
    document: FlowDraftSession['workingDraft'] | null,
    nodeOverride?: PendingNodeOverrideForSave,
) {
    if (!document) {
        return null;
    }

    const nodes = flattenFlowDocumentNodes(document).map((node) => {
        if (!nodeOverride || node.taskId !== nodeOverride.taskId) {
            return node;
        }
        return {
            ...node,
            scriptContent: nodeOverride.content,
            dataSourceId: nodeOverride.dataSourceId,
            dataSourceType: nodeOverride.dataSourceType,
            transfer: nodeOverride.transfer,
            transferDraft: nodeOverride.transferDraft,
            transferDraftValid: nodeOverride.transferDraftValid,
        };
    });

    return nodes.find((node) => node.kind === 'TRANSFER' && node.transferDraftValid === false) ?? null;
}

export function isSaveConflictError(error: unknown) {
    return error instanceof AxiosError && error.response?.status === 409;
}
