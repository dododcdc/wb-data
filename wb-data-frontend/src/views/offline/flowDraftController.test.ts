import { describe, expect, it } from 'vitest';
import {
    forceOverwriteRebase,
    rebaseFlowDraftSession,
    type FlowDraftSession,
} from './flowDraftController';

function makeDocument(overrides?: Partial<FlowDraftSession['baseDocument']>) {
    return {
        groupId: 1,
        path: '_flows/example.yml',
        flowId: 'example',
        namespace: 'team.example',
        documentHash: 'base-hash',
        documentUpdatedAt: 100,
        stages: [],
        edges: [],
        layout: {},
        ...overrides,
    };
}

describe('forceOverwriteRebase', () => {
    it('refreshes base metadata while preserving the current working draft', () => {
        const session: FlowDraftSession = {
            path: '_flows/example.yml',
            baseDocument: makeDocument(),
            workingDraft: makeDocument({
                documentHash: 'draft-hash',
                documentUpdatedAt: 90,
                stages: [{ stageId: 'stage-1', parallel: false, nodes: [] }],
            }),
            selectedNodeId: 'node-1',
            selectedTaskIds: ['node-1'],
            conflict: {
                kind: 'stale-recovery',
                snapshot: {
                    document: makeDocument(),
                    baseDocumentHash: 'old-hash',
                    baseDocumentUpdatedAt: 10,
                    selectedNodeId: 'node-1',
                    selectedTaskIds: ['node-1'],
                    updatedAt: 11,
                },
            },
        };

        const latestServer = makeDocument({
            documentHash: 'server-hash',
            documentUpdatedAt: 200,
        });

        const next = forceOverwriteRebase(session, latestServer);

        expect(next.baseDocument.documentHash).toBe('server-hash');
        expect(next.baseDocument.documentUpdatedAt).toBe(200);
        expect(next.workingDraft.documentHash).toBe('draft-hash');
        expect(next.workingDraft.stages).toEqual([{ stageId: 'stage-1', parallel: false, nodes: [] }]);
        expect(next.selectedNodeId).toBe('node-1');
        expect(next.selectedTaskIds).toEqual(['node-1']);
        expect(next.conflict).toBeNull();
    });
});

describe('rebaseFlowDraftSession', () => {
    it('replaces base and working documents with the saved server response while preserving selection', () => {
        const session: FlowDraftSession = {
            path: '_flows/example.yml',
            baseDocument: makeDocument(),
            workingDraft: makeDocument({
                documentHash: 'draft-hash',
                documentUpdatedAt: 90,
                stages: [{ stageId: 'stage-1', parallel: false, nodes: [] }],
            }),
            selectedNodeId: 'node-1',
            selectedTaskIds: ['node-1'],
            conflict: {
                kind: 'stale-recovery',
                snapshot: {
                    document: makeDocument(),
                    baseDocumentHash: 'old-hash',
                    baseDocumentUpdatedAt: 10,
                    selectedNodeId: 'node-1',
                    selectedTaskIds: ['node-1'],
                    updatedAt: 11,
                },
            },
        };

        const savedDocument = makeDocument({
            documentHash: 'saved-hash',
            documentUpdatedAt: 300,
            stages: [{ stageId: 'saved-stage', parallel: false, nodes: [] }],
        });

        const next = rebaseFlowDraftSession(session, savedDocument);

        expect(next.baseDocument.documentHash).toBe('saved-hash');
        expect(next.workingDraft.documentHash).toBe('saved-hash');
        expect(next.workingDraft.stages).toEqual([{ stageId: 'saved-stage', parallel: false, nodes: [] }]);
        expect(next.selectedNodeId).toBe('node-1');
        expect(next.selectedTaskIds).toEqual(['node-1']);
        expect(next.conflict).toBeNull();
    });
});
