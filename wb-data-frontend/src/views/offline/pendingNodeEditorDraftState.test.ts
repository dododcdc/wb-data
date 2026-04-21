import { describe, expect, it } from 'vitest';

import type { OfflineFlowDocument } from '../../api/offline';
import type { PendingNodeEditorDraft } from './flowDraftController';
import { resolvePendingNodeEditorDraftAfterDocumentChange } from './pendingNodeEditorDraftState';

function createDocument(taskIds: string[]): OfflineFlowDocument {
    return {
        groupId: 7,
        path: '_flows/demo/flow.yaml',
        flowId: 'demo',
        namespace: 'pg-7',
        documentHash: 'hash-1',
        documentUpdatedAt: 100,
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes: taskIds.map((taskId) => ({
                    taskId,
                    kind: 'SQL' as const,
                    scriptPath: `scripts/demo/${taskId}.sql`,
                    scriptContent: `select '${taskId}'`,
                })),
            },
        ],
        edges: [],
        layout: Object.fromEntries(taskIds.map((taskId, index) => [taskId, { x: index * 10, y: 20 }])),
    };
}

describe('resolvePendingNodeEditorDraftAfterDocumentChange', () => {
    it('keeps the pending draft when the edited node still exists', () => {
        const pendingDraft: PendingNodeEditorDraft = {
            taskId: 'node-a',
            scriptContent: 'select 2',
        };

        expect(resolvePendingNodeEditorDraftAfterDocumentChange(
            pendingDraft,
            createDocument(['node-a', 'node-b']),
        )).toEqual(pendingDraft);
    });

    it('clears the pending draft when the edited node is removed from the document', () => {
        const pendingDraft: PendingNodeEditorDraft = {
            taskId: 'node-a',
            scriptContent: 'select 2',
        };

        expect(resolvePendingNodeEditorDraftAfterDocumentChange(
            pendingDraft,
            createDocument(['node-b']),
        )).toBeNull();
    });
});
