import { describe, expect, it, vi } from 'vitest';

import type { OfflineFlowDocument } from '../../api/offline';
import { createFlowDraftSession } from './flowDraftController';
import { clearDeletedFolderDraftState } from './deletedFolderDraftState';

function createServerDocument(): OfflineFlowDocument {
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
                nodes: [
                    {
                        taskId: 'node-a',
                        kind: 'SQL',
                        scriptPath: 'scripts/demo/node-a.sql',
                        scriptContent: 'select 1',
                    },
                ],
            },
        ],
        edges: [],
        layout: { 'node-a': { x: 10, y: 20 } },
    };
}

describe('clearDeletedFolderDraftState', () => {
    it('flushes the active flow draft before clearing state for a deleted folder', () => {
        const session = createFlowDraftSession({
            path: '_flows/demo/flow.yaml',
            serverDocument: createServerDocument(),
            snapshot: null,
        });
        const leaveCurrentFlow = vi.fn();

        const result = clearDeletedFolderDraftState({
            activeFlowPath: '_flows/demo/flow.yaml',
            deleteFolderPath: '_flows/demo',
            draftSession: session,
            leaveCurrentFlow,
        });

        expect(leaveCurrentFlow).toHaveBeenCalledWith(session);
        expect(result).toEqual({
            activeFlowPath: null,
            draftSession: null,
        });
    });

    it('keeps the current flow state when the deleted folder does not contain it', () => {
        const session = createFlowDraftSession({
            path: '_flows/demo/flow.yaml',
            serverDocument: createServerDocument(),
            snapshot: null,
        });
        const leaveCurrentFlow = vi.fn();

        const result = clearDeletedFolderDraftState({
            activeFlowPath: '_flows/demo/flow.yaml',
            deleteFolderPath: '_flows/other',
            draftSession: session,
            leaveCurrentFlow,
        });

        expect(leaveCurrentFlow).not.toHaveBeenCalled();
        expect(result).toEqual({
            activeFlowPath: '_flows/demo/flow.yaml',
            draftSession: session,
        });
    });
});
