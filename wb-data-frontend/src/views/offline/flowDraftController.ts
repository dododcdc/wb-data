import type { OfflineFlowDocument } from '../../api/offline';

import { buildFlowDocumentSignature } from './flowCanvasState';
import type { RecoverySnapshot } from './recoverySnapshotStore';

export interface DraftConflict {
    kind: 'stale-recovery';
    snapshot: RecoverySnapshot;
}

export interface FlowDraftSession {
    path: string;
    baseDocument: OfflineFlowDocument;
    workingDraft: OfflineFlowDocument;
    selectedNodeId: string | null;
    selectedTaskIds: string[];
    conflict: DraftConflict | null;
}

export interface PendingNodeEditorDraft {
    taskId: string;
    scriptContent: string;
    dataSourceId?: number;
    dataSourceType?: string;
}

function cloneDocument(document: OfflineFlowDocument): OfflineFlowDocument {
    return {
        ...document,
        stages: document.stages.map((stage) => ({
            ...stage,
            nodes: stage.nodes.map((node) => ({ ...node })),
        })),
        edges: document.edges.map((edge) => ({ ...edge })),
        layout: Object.fromEntries(
            Object.entries(document.layout).map(([taskId, position]) => [taskId, { ...position }]),
        ),
    };
}

export function createFlowDraftSession(args: {
    path: string;
    serverDocument: OfflineFlowDocument;
    snapshot: RecoverySnapshot | null;
}): FlowDraftSession {
    const { path, serverDocument, snapshot } = args;
    const matchingSnapshot =
        snapshot &&
        snapshot.baseDocumentHash === serverDocument.documentHash &&
        snapshot.baseDocumentUpdatedAt === serverDocument.documentUpdatedAt;

    return {
        path,
        baseDocument: cloneDocument(serverDocument),
        workingDraft: cloneDocument(matchingSnapshot ? snapshot.document : serverDocument),
        selectedNodeId: matchingSnapshot ? snapshot.selectedNodeId : null,
        selectedTaskIds: matchingSnapshot ? [...snapshot.selectedTaskIds] : [],
        conflict:
            snapshot && !matchingSnapshot
                ? {
                      kind: 'stale-recovery',
                      snapshot,
                  }
                : null,
    };
}

export function updateFlowDraftDocument(
    session: FlowDraftSession,
    updater: (draft: OfflineFlowDocument) => void,
): FlowDraftSession {
    const nextDraft = cloneDocument(session.workingDraft);
    updater(nextDraft);
    return { ...session, workingDraft: nextDraft };
}

export function replaceFlowDraftWorkingDocument(
    session: FlowDraftSession,
    document: OfflineFlowDocument,
): FlowDraftSession {
    return {
        ...session,
        workingDraft: cloneDocument(document),
    };
}

export function flushNodeEditorDraft(
    session: FlowDraftSession,
    input: PendingNodeEditorDraft,
): FlowDraftSession {
    return updateFlowDraftDocument(session, (draft) => {
        draft.stages.forEach((stage) => {
            stage.nodes = stage.nodes.map((node) =>
                node.taskId === input.taskId
                    ? {
                          ...node,
                          scriptContent: input.scriptContent,
                          ...(input.dataSourceId !== undefined ? { dataSourceId: input.dataSourceId } : {}),
                          ...(input.dataSourceType !== undefined ? { dataSourceType: input.dataSourceType } : {}),
                      }
                    : node,
            );
        });
    });
}

export function hasFlowDraftChanges(session: FlowDraftSession) {
    return buildFlowDocumentSignature(session.workingDraft) !== buildFlowDocumentSignature(session.baseDocument);
}

export function buildRecoverySnapshotFromSession(session: FlowDraftSession, updatedAt: number): RecoverySnapshot {
    return {
        document: cloneDocument(session.workingDraft),
        baseDocumentHash: session.baseDocument.documentHash,
        baseDocumentUpdatedAt: session.baseDocument.documentUpdatedAt,
        selectedNodeId: session.selectedNodeId,
        selectedTaskIds: [...session.selectedTaskIds],
        updatedAt,
    };
}

export function prepareSessionForLeave(
    session: FlowDraftSession,
    pendingEditor: PendingNodeEditorDraft | null,
    updatedAt: number,
) {
    const nextSession = pendingEditor ? flushNodeEditorDraft(session, pendingEditor) : session;

    return {
        nextSession,
        snapshot: hasFlowDraftChanges(nextSession) ? buildRecoverySnapshotFromSession(nextSession, updatedAt) : null,
    };
}

export function resolveDraftConflict(
    session: FlowDraftSession,
    strategy: 'restore-local' | 'load-server',
): FlowDraftSession {
    if (!session.conflict) return session;

    return strategy === 'restore-local'
        ? {
              ...session,
              workingDraft: cloneDocument(session.conflict.snapshot.document),
              selectedNodeId: session.conflict.snapshot.selectedNodeId,
              selectedTaskIds: [...session.conflict.snapshot.selectedTaskIds],
              conflict: null,
          }
        : {
              ...session,
              workingDraft: cloneDocument(session.baseDocument),
              selectedNodeId: null,
              selectedTaskIds: [],
              conflict: null,
          };
}

export function forceOverwriteRebase(
    session: FlowDraftSession,
    serverDocument: OfflineFlowDocument,
): FlowDraftSession {
    return {
        ...session,
        baseDocument: cloneDocument(serverDocument),
        workingDraft: cloneDocument(session.workingDraft),
        selectedNodeId: session.selectedNodeId,
        selectedTaskIds: [...session.selectedTaskIds],
        conflict: null,
    };
}
