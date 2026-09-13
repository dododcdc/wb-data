import { AxiosError } from 'axios';

import type {
    FlowParameterBinding,
    FlowParameterBindingRequest,
    SaveOfflineFlowDocumentRequest,
} from '../../api/offline';
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
    const bindingRequests = buildParameterBindingRequests(
        session.baseDocument.parameterBinding,
        draftDocument.parameterBinding,
    );
    if (!draftDocument.runtimeTimezone) {
        throw new Error('任务运行时区不能为空，请先选择运行时区');
    }

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
                ...(node.transfer !== undefined ? { transfer: node.transfer } : {}),
            })),
        })),
        edges: draftDocument.edges,
        layout: draftDocument.layout,
        schedule: draftDocument.schedule ?? undefined,
        runtimeTimezone: draftDocument.runtimeTimezone,
        ...(bindingRequests !== undefined ? bindingRequests : {}),
    };
}

function buildParameterBindingRequests(
    baseBinding: FlowParameterBinding | null | undefined,
    draftBinding: FlowParameterBinding | null | undefined,
): { parameterBinding?: FlowParameterBindingRequest | null; parameterBindings?: FlowParameterBindingRequest[] | null } | undefined {
    const serializeBinding = (b: FlowParameterBinding | null | undefined) => {
        if (!b) return null;
        if (b.bindings && b.bindings.length > 0) {
            return b.bindings.map((item) => `${item.parameterGroupId ?? ''}:${item.code}:${item.boundVersion}`).join(',');
        }
        return `${b.parameterGroupId ?? ''}:${b.code}:${b.boundVersion}`;
    };

    const baseIdentity = serializeBinding(baseBinding);
    const draftIdentity = serializeBinding(draftBinding);
    if (baseIdentity === draftIdentity) {
        return undefined;
    }
    if (!draftBinding) {
        return { parameterBinding: {}, parameterBindings: [] };
    }
    if (draftBinding.bindings && draftBinding.bindings.length > 0) {
        const list: FlowParameterBindingRequest[] = draftBinding.bindings
            .filter((item) => item.parameterGroupId != null)
            .map((item) => ({
                parameterGroupId: item.parameterGroupId!,
                expectedVersion: item.boundVersion,
            }));
        return {
            parameterBinding: list.length > 0 ? list[0] : {},
            parameterBindings: list,
        };
    }
    if (draftBinding.parameterGroupId == null) {
        return undefined;
    }
    return {
        parameterBinding: {
            parameterGroupId: draftBinding.parameterGroupId,
            expectedVersion: draftBinding.boundVersion,
        },
        parameterBindings: [{
            parameterGroupId: draftBinding.parameterGroupId,
            expectedVersion: draftBinding.boundVersion,
        }],
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
