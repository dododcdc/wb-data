import { describe, expect, it } from 'vitest';

import type { OfflineFlowDocument } from '../../api/offline';
import type { RecoverySnapshot } from './recoverySnapshotStore';
import {
    buildRecoverySnapshotFromSession,
    createFlowDraftSession,
    flushNodeEditorDraft,
    hasFlowDraftChanges,
    prepareSessionForLeave,
    rebaseFlowDraftSession,
    replaceFlowDraftWorkingDocument,
    resolveDraftConflict,
    updateFlowDraftDocument,
} from './flowDraftController';

const path = '_flows/totot/flow.yaml';

const serverDocument: OfflineFlowDocument = {
    groupId: 1,
    path,
    flowId: 'totot',
    namespace: 'pg-1',
    documentHash: 'server-hash',
    documentUpdatedAt: 200,
    stages: [
        {
            stageId: 'main',
            parallel: false,
            nodes: [
                {
                    taskId: 'a',
                    kind: 'SQL',
                    scriptPath: 'scripts/totot/a.sql',
                    scriptContent: 'select 1',
                    dataSourceId: 11,
                    dataSourceType: 'HIVE',
                },
            ],
        },
    ],
    edges: [],
    layout: { a: { x: 10, y: 20 } },
};

describe('flowDraftController', () => {
    it('creates a working draft from a matching recovery snapshot', () => {
        const snapshot: RecoverySnapshot = {
            document: {
                ...serverDocument,
                stages: [
                    {
                        ...serverDocument.stages[0],
                        nodes: [{ ...serverDocument.stages[0].nodes[0], scriptContent: 'select 2' }],
                    },
                ],
            },
            baseDocumentHash: 'server-hash',
            baseDocumentUpdatedAt: 200,
            selectedNodeId: 'a',
            selectedTaskIds: ['a'],
            updatedAt: 999,
        };

        const session = createFlowDraftSession({ path, serverDocument, snapshot });
        expect(session.workingDraft.stages[0].nodes[0].scriptContent).toBe('select 2');
        expect(session.conflict).toBeNull();
    });

    it('marks stale recovery snapshots as a conflict instead of auto-restoring them', () => {
        const staleSnapshot: RecoverySnapshot = {
            document: {
                ...serverDocument,
                stages: [
                    {
                        ...serverDocument.stages[0],
                        nodes: [{ ...serverDocument.stages[0].nodes[0], scriptContent: 'select stale' }],
                    },
                ],
            },
            baseDocumentHash: 'older-hash',
            baseDocumentUpdatedAt: 100,
            selectedNodeId: 'a',
            selectedTaskIds: ['a'],
            updatedAt: 555,
        };

        const session = createFlowDraftSession({ path, serverDocument, snapshot: staleSnapshot });
        expect(session.workingDraft.stages[0].nodes[0].scriptContent).toBe('select 1');
        expect(session.conflict?.kind).toBe('stale-recovery');
        expect(session.selectedNodeId).toBeNull();
        expect(session.selectedTaskIds).toEqual([]);

        const serverLoaded = resolveDraftConflict(session, 'load-server');
        expect(serverLoaded.workingDraft.stages[0].nodes[0].scriptContent).toBe('select 1');
        expect(serverLoaded.selectedNodeId).toBeNull();
        expect(serverLoaded.selectedTaskIds).toEqual([]);

        const restored = resolveDraftConflict(session, 'restore-local');
        expect(restored.workingDraft.stages[0].nodes[0].scriptContent).toBe('select stale');
    });

    it('flushes pending node-editor content into the working draft and emits a recovery snapshot', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const patched = flushNodeEditorDraft(session, {
            taskId: 'a',
            scriptContent: 'select 42',
            dataSourceId: 99,
            dataSourceType: 'STARROCKS',
        });

        expect(hasFlowDraftChanges(patched)).toBe(true);
        expect(patched.workingDraft.stages[0].nodes[0].dataSourceId).toBe(99);

        const recovery = buildRecoverySnapshotFromSession(patched, 1234);
        expect(recovery.document.stages[0].nodes[0].scriptContent).toBe('select 42');
        expect(recovery.updatedAt).toBe(1234);
    });

    it('preserves existing node data-source fields when pending editor input omits them', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const patched = flushNodeEditorDraft(session, {
            taskId: 'a',
            scriptContent: 'select 42',
        });

        expect(patched.workingDraft.stages[0].nodes[0].dataSourceId).toBe(11);
        expect(patched.workingDraft.stages[0].nodes[0].dataSourceType).toBe('HIVE');
    });

    it('clones selected task ids when restoring a local draft conflict', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const conflicted: typeof session = {
            ...session,
            conflict: {
                kind: 'stale-recovery',
                snapshot: {
                    document: serverDocument,
                    baseDocumentHash: serverDocument.documentHash,
                    baseDocumentUpdatedAt: serverDocument.documentUpdatedAt,
                    selectedNodeId: 'a',
                    selectedTaskIds: ['a'],
                    updatedAt: 999,
                },
            },
        };

        const restored = resolveDraftConflict(conflicted, 'restore-local');

        expect(restored.selectedTaskIds).toEqual(['a']);
        expect(restored.selectedTaskIds).not.toBe(conflicted.conflict!.snapshot.selectedTaskIds);
    });

    it('resets dirty state when the saved server document becomes the new base document', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const dirty = updateFlowDraftDocument(session, (draft) => {
            draft.stages[0].nodes[0].scriptContent = 'select 7';
        });

        const reset = createFlowDraftSession({
            path,
            serverDocument: dirty.workingDraft,
            snapshot: null,
        });

        expect(hasFlowDraftChanges(reset)).toBe(false);
    });

    it('prepares a session for leave with pending editor changes', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const result = prepareSessionForLeave(session, {
            taskId: 'a',
            scriptContent: 'select 99',
            dataSourceId: 77,
            dataSourceType: 'POSTGRES',
        }, 4321);

        expect(result.nextSession.workingDraft.stages[0].nodes[0].scriptContent).toBe('select 99');
        expect(result.snapshot?.document.stages[0].nodes[0].scriptContent).toBe('select 99');
        expect(result.snapshot?.updatedAt).toBe(4321);
    });

    it('replaces the working draft with a new document snapshot', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const replacement: OfflineFlowDocument = {
            ...serverDocument,
            stages: [
                {
                    ...serverDocument.stages[0],
                    nodes: [{ ...serverDocument.stages[0].nodes[0], scriptContent: 'select replacement' }],
                },
            ],
        };

        const replaced = replaceFlowDraftWorkingDocument(session, replacement);

        expect(replaced.workingDraft.stages[0].nodes[0].scriptContent).toBe('select replacement');
        expect(session.workingDraft.stages[0].nodes[0].scriptContent).toBe('select 1');
        expect(replaced.workingDraft).not.toBe(replacement);
    });

    it('re-bases the session on a saved server document while preserving selection', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const dirty = updateFlowDraftDocument(session, (draft) => {
            draft.stages[0].nodes[0].scriptContent = 'select saved';
        });
        const selected = {
            ...dirty,
            selectedNodeId: 'a',
            selectedTaskIds: ['a'],
        };
        const savedServerDocument: OfflineFlowDocument = {
            ...dirty.workingDraft,
            documentHash: 'saved-hash',
            documentUpdatedAt: 300,
        };

        const rebased = rebaseFlowDraftSession(selected, savedServerDocument);

        expect(rebased.baseDocument.documentHash).toBe('saved-hash');
        expect(rebased.workingDraft.documentHash).toBe('saved-hash');
        expect(rebased.selectedNodeId).toBe('a');
        expect(rebased.selectedTaskIds).toEqual(['a']);
        expect(rebased.selectedTaskIds).not.toBe(selected.selectedTaskIds);
        expect(hasFlowDraftChanges(rebased)).toBe(false);
    });

    it('treats data-source-only edits as draft changes', () => {
        const session = createFlowDraftSession({ path, serverDocument, snapshot: null });
        const patched = flushNodeEditorDraft(session, {
            taskId: 'a',
            scriptContent: 'select 1',
            dataSourceId: 22,
            dataSourceType: 'STARROCKS',
        });

        expect(hasFlowDraftChanges(patched)).toBe(true);
        expect(patched.workingDraft.stages[0].nodes[0].dataSourceType).toBe('STARROCKS');
    });
});
