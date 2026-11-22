import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    listRecoverySnapshotPaths,
    moveFolderRecoverySnapshots,
    moveRecoverySnapshot,
    readRecoverySnapshot,
    writeRecoverySnapshot,
} from './recoverySnapshotStore';
import type { RecoverySnapshot } from './recoverySnapshotStore';

function makeSnapshot(path = 'test/flow.yml'): RecoverySnapshot {
    return {
        document: {
            groupId: 1,
            path,
            flowId: 'flow-id',
            namespace: 'ns',
            documentHash: 'abc',
            documentUpdatedAt: 1000,
            stages: [],
            edges: [],
            layout: {},
        },
        baseDocumentHash: 'abc',
        baseDocumentUpdatedAt: 1000,
        selectedNodeId: null,
        selectedTaskIds: [],
        updatedAt: 1000,
    };
}

function makeStorage() {
    const store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        key: vi.fn((n: number) => Object.keys(store)[n] ?? null),
        get length() { return Object.keys(store).length; },
        _store: store,
    };
}

describe('writeRecoverySnapshot', () => {
    let mockStorage: ReturnType<typeof makeStorage>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockStorage = makeStorage();
        vi.stubGlobal('localStorage', mockStorage);
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('does not throw when localStorage.setItem throws QuotaExceededError', () => {
        mockStorage.setItem.mockImplementation(() => {
            throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        });

        expect(() => writeRecoverySnapshot(1, 'test/flow.yml', makeSnapshot())).not.toThrow();
    });

    it('logs a console.warn when localStorage.setItem throws', () => {
        mockStorage.setItem.mockImplementation(() => {
            throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        });

        writeRecoverySnapshot(1, 'test/flow.yml', makeSnapshot());

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[recovery-snapshot]'),
            expect.anything(),
        );
    });

    it('still writes when localStorage works normally', () => {
        writeRecoverySnapshot(1, 'test/flow.yml', makeSnapshot());

        expect(mockStorage.setItem).toHaveBeenCalledWith(
            'wb-data:offline-recovery:1:test/flow.yml',
            expect.stringContaining('"baseDocumentHash":"abc"'),
        );
    });

    it('lists only recovery snapshot paths for the requested group', () => {
        writeRecoverySnapshot(1, '_flows/a/flow.yaml', makeSnapshot());
        writeRecoverySnapshot(2, '_flows/b/flow.yaml', makeSnapshot());

        expect(listRecoverySnapshotPaths(1)).toEqual(['_flows/a/flow.yaml']);
        expect(listRecoverySnapshotPaths(2)).toEqual(['_flows/b/flow.yaml']);
    });
});

describe('move recovery snapshots', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', makeStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        ['_flows/target/demo/flow.yaml', 'scripts/target/demo/'],
        ['_flows/target/nested/renamed/flow.yaml', 'scripts/target/nested/renamed/'],
    ])('moves a flow to %s while preserving content, selection and the original baseline', (newPath, newScriptPrefix) => {
        const oldPath = '_flows/source/demo/flow.yaml';
        const snapshot = makeSnapshot(oldPath);
        snapshot.document.stages = [
            {
                stageId: 'prepare',
                parallel: false,
                nodes: [{
                    taskId: 'shell',
                    kind: 'SHELL',
                    scriptPath: 'scripts/source/demo/shell.sh',
                    scriptContent: 'echo scripts/source/demo/keep-this-content',
                }],
            },
            {
                stageId: 'load',
                parallel: true,
                nodes: [{
                    taskId: 'query',
                    kind: 'MYSQL',
                    scriptPath: 'scripts/source/demo/nested/query.sql',
                    scriptContent: 'SELECT 1; -- unsaved',
                    dataSourceId: 42,
                    dataSourceType: 'MYSQL',
                }],
            },
        ];
        snapshot.document.edges = [{ source: 'shell', target: 'query' }];
        snapshot.document.layout = { shell: { x: 10, y: 20 }, query: { x: 30, y: 40 } };
        snapshot.baseDocumentHash = 'original-baseline';
        snapshot.baseDocumentUpdatedAt = 500;
        snapshot.selectedNodeId = 'query';
        snapshot.selectedTaskIds = ['shell', 'query'];
        snapshot.updatedAt = 2000;
        writeRecoverySnapshot(1, oldPath, snapshot);

        moveRecoverySnapshot(1, oldPath, newPath);

        expect(readRecoverySnapshot(1, oldPath)).toBeNull();
        expect(listRecoverySnapshotPaths(1)).toEqual([newPath]);
        expect(readRecoverySnapshot(1, newPath)).toEqual({
            ...snapshot,
            document: {
                ...snapshot.document,
                path: newPath,
                stages: snapshot.document.stages.map((stage, index) => ({
                    ...stage,
                    nodes: [{
                        ...stage.nodes[0],
                        scriptPath: `${newScriptPrefix}${index === 0 ? 'shell.sh' : 'nested/query.sql'}`,
                    }],
                })),
            },
        });
    });

    it('only replaces the exact task scripts prefix and leaves transfers and absent paths unchanged', () => {
        const oldPath = '_flows/source/demo/flow.yaml';
        const newPath = '_flows/target/demo/flow.yaml';
        const snapshot = makeSnapshot(oldPath);
        snapshot.document.stages = [{
            stageId: 'stage',
            parallel: true,
            nodes: [
                { taskId: 'own', kind: 'SHELL', scriptPath: 'scripts/source/demo/scripts/source/demo/run.sh' },
                { taskId: 'sibling', kind: 'SHELL', scriptPath: 'scripts/source/demo-copy/run.sh' },
                { taskId: 'other', kind: 'SHELL', scriptPath: 'scripts/other/demo/run.sh' },
                { taskId: 'embedded', kind: 'SHELL', scriptPath: 'archive/scripts/source/demo/run.sh' },
                { taskId: 'directory', kind: 'SHELL', scriptPath: 'scripts/source/demo' },
                { taskId: 'transfer', kind: 'TRANSFER', scriptPath: 'transfers/demo/load.transfer.json', transferDraftValid: false },
                { taskId: 'absent', kind: 'SHELL', scriptContent: 'unsaved content' },
                { taskId: 'empty', kind: 'SHELL', scriptPath: '' },
            ],
        }];
        writeRecoverySnapshot(1, oldPath, snapshot);

        moveRecoverySnapshot(1, oldPath, newPath);

        expect(readRecoverySnapshot(1, newPath)?.document.stages[0].nodes).toEqual([
            { ...snapshot.document.stages[0].nodes[0], scriptPath: 'scripts/target/demo/scripts/source/demo/run.sh' },
            ...snapshot.document.stages[0].nodes.slice(1),
        ]);
    });

    it('moves every nested folder snapshot with its own scripts prefix without affecting siblings or other groups', () => {
        const paths = ['_flows/source/demo/flow.yaml', '_flows/source/nested/second/flow.yaml'];
        const snapshots = paths.map((path, index) => {
            const snapshot = makeSnapshot(path);
            snapshot.document.stages = [{
                stageId: `stage-${index}`,
                parallel: false,
                nodes: [{
                    taskId: `node-${index}`,
                    kind: 'SHELL',
                    scriptPath: index === 0 ? 'scripts/source/demo/run.sh' : 'scripts/source/nested/second/run.sh',
                    scriptContent: `unsaved-${index}`,
                }],
            }];
            writeRecoverySnapshot(1, path, snapshot);
            return snapshot;
        });
        const sibling = makeSnapshot('_flows/source-copy/demo/flow.yaml');
        writeRecoverySnapshot(1, sibling.document.path, sibling);
        const otherGroup = makeSnapshot(paths[0]);
        otherGroup.document.groupId = 2;
        writeRecoverySnapshot(2, paths[0], otherGroup);

        moveFolderRecoverySnapshots(1, '_flows/source', '_flows/target/moved');

        const newPaths = ['_flows/target/moved/demo/flow.yaml', '_flows/target/moved/nested/second/flow.yaml'];
        const newScriptPaths = ['scripts/target/moved/demo/run.sh', 'scripts/target/moved/nested/second/run.sh'];
        snapshots.forEach((snapshot, index) => {
            expect(readRecoverySnapshot(1, paths[index])).toBeNull();
            expect(readRecoverySnapshot(1, newPaths[index])).toEqual({
                ...snapshot,
                document: {
                    ...snapshot.document,
                    path: newPaths[index],
                    stages: [{
                        ...snapshot.document.stages[0],
                        nodes: [{ ...snapshot.document.stages[0].nodes[0], scriptPath: newScriptPaths[index] }],
                    }],
                },
            });
        });
        expect(listRecoverySnapshotPaths(1).sort()).toEqual([...newPaths, sibling.document.path].sort());
        expect(readRecoverySnapshot(1, sibling.document.path)).toEqual(sibling);
        expect(readRecoverySnapshot(2, paths[0])).toEqual(otherGroup);
    });
});
