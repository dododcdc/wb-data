import { describe, expect, it } from 'vitest';
import {
    createFlowDraftSession,
    forceOverwriteRebase,
    hasFlowDraftChanges,
    rebaseFlowDraftSession,
    updateFlowParameterBindingDraft,
    updateFlowScheduleDraft,
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

describe('Flow parameter binding draft', () => {
    it('marks a parameter binding change as an unsaved Flow change', () => {
        const session = createFlowDraftSession({
            path: '_flows/example.yml',
            serverDocument: makeDocument(),
            snapshot: null,
        });

        const next = updateFlowParameterBindingDraft(session, {
            parameterGroupId: 8,
            code: 'daily_common',
            name: '日常公共参数',
            boundVersion: 2,
            currentVersion: 2,
            status: 'CURRENT',
            definitions: [],
        });

        expect(hasFlowDraftChanges(next)).toBe(true);
        expect(next.workingDraft.parameterBinding).toMatchObject({
            parameterGroupId: 8,
            code: 'daily_common',
            boundVersion: 2,
        });
    });
});

describe('Flow schedule draft', () => {
    it('keeps the Flow runtime timezone fixed and applies it to the schedule', () => {
        const session = createFlowDraftSession({
            path: '_flows/example.yml',
            serverDocument: makeDocument({ runtimeTimezone: 'Asia/Shanghai' }),
            snapshot: null,
        });

        const next = updateFlowScheduleDraft(session, {
            cron: '0 2 * * *',
            timezone: 'Asia/Singapore',
            enabled: true,
        });

        expect(next.workingDraft.runtimeTimezone).toBe('Asia/Shanghai');
        expect(next.workingDraft.schedule?.timezone).toBe('Asia/Shanghai');
    });
});
