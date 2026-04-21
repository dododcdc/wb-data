import { describe, expect, it } from 'vitest';
import type { OfflineFlowDocument } from '../../api/offline';
import {
    buildFlowDocumentSignature,
} from './flowCanvasState';
import {
    moveFolderRecoverySnapshots,
    moveRecoverySnapshot,
    readRecoverySnapshot,
    removeFolderRecoverySnapshots,
    removeRecoverySnapshot,
    writeRecoverySnapshot,
    type RecoverySnapshot,
} from './recoverySnapshotStore';

function createSnapshot(): RecoverySnapshot {
    return {
        document: createDocument(),
        baseDocumentHash: 'base-hash',
        baseDocumentUpdatedAt: 456,
        selectedNodeId: 'extract',
        selectedTaskIds: ['extract'],
        updatedAt: 123,
    };
}

function createDocument(): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/demo/flow.yaml',
        flowId: 'demo',
        namespace: 'pg-1',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        stages: [
            {
                stageId: 'stage-1',
                parallel: false,
                nodes: [
                    {
                        taskId: 'extract',
                        kind: 'SQL',
                        scriptPath: 'scripts/extract.sql',
                        scriptContent: 'select 1;',
                        dataSourceId: 11,
                        dataSourceType: 'mysql',
                    },
                ],
            },
        ],
        edges: [],
        layout: {
            extract: { x: 10, y: 20 },
        },
    };
}

describe('recoverySnapshotStore', () => {
    it('writes, reads, moves, and removes snapshots by group and flow path', () => {
        const snapshot = createSnapshot();

        expect(readRecoverySnapshot(1, '_flows/demo/flow.yaml')).toBeNull();

        writeRecoverySnapshot(1, '_flows/demo/flow.yaml', snapshot);
        expect(readRecoverySnapshot(1, '_flows/demo/flow.yaml')).toEqual(snapshot);

        moveRecoverySnapshot(1, '_flows/demo/flow.yaml', '_flows/demo-renamed/flow.yaml');
        expect(readRecoverySnapshot(1, '_flows/demo/flow.yaml')).toBeNull();
        expect(readRecoverySnapshot(1, '_flows/demo-renamed/flow.yaml')).toEqual({
            ...snapshot,
            document: {
                ...snapshot.document,
                path: '_flows/demo-renamed/flow.yaml',
            },
        });

        removeRecoverySnapshot(1, '_flows/demo-renamed/flow.yaml');
        expect(readRecoverySnapshot(1, '_flows/demo-renamed/flow.yaml')).toBeNull();
    });

    it.each([
        ['groupId', { groupId: '1' }],
        ['path', { path: 123 }],
        ['flowId', { flowId: 456 }],
        ['namespace', { namespace: 789 }],
        ['documentHash', { documentHash: true }],
        ['documentUpdatedAt', { documentUpdatedAt: '1' }],
    ])('rejects corrupted document scalar field %s', (_fieldName, overrides) => {
        const snapshot = createSnapshot();
        writeRecoverySnapshot(1, '_flows/demo/flow.yaml', {
            ...snapshot,
            document: {
                ...snapshot.document,
                ...overrides,
            },
        } as unknown as RecoverySnapshot);

        expect(readRecoverySnapshot(1, '_flows/demo/flow.yaml')).toBeNull();
    });

    it('changes the flow signature when only the data source changes', () => {
        const original = createDocument();
        const next = {
            ...original,
            stages: [
                {
                    ...original.stages[0],
                    nodes: [
                        {
                            ...original.stages[0].nodes[0],
                            dataSourceId: 22,
                            dataSourceType: 'postgres',
                        },
                    ],
                },
            ],
        } satisfies OfflineFlowDocument;

        expect(buildFlowDocumentSignature(next)).not.toBe(buildFlowDocumentSignature(original));
    });

    it('moves and removes snapshots for every flow under a folder prefix', () => {
        const snapshot = createSnapshot();
        writeRecoverySnapshot(1, '_flows/folder-a/one/flow.yaml', {
            ...snapshot,
            document: {
                ...snapshot.document,
                path: '_flows/folder-a/one/flow.yaml',
            },
        });
        writeRecoverySnapshot(1, '_flows/folder-a/two/flow.yaml', {
            ...snapshot,
            document: {
                ...snapshot.document,
                path: '_flows/folder-a/two/flow.yaml',
            },
        });

        moveFolderRecoverySnapshots(1, '_flows/folder-a', '_flows/folder-b');
        expect(readRecoverySnapshot(1, '_flows/folder-a/one/flow.yaml')).toBeNull();
        expect(readRecoverySnapshot(1, '_flows/folder-b/one/flow.yaml')).not.toBeNull();
        expect(readRecoverySnapshot(1, '_flows/folder-b/two/flow.yaml')).not.toBeNull();

        removeFolderRecoverySnapshots(1, '_flows/folder-b');
        expect(readRecoverySnapshot(1, '_flows/folder-b/one/flow.yaml')).toBeNull();
        expect(readRecoverySnapshot(1, '_flows/folder-b/two/flow.yaml')).toBeNull();
    });
});
