import { act, renderHook } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OfflineFlowDocument } from '../../api/offline';
import { getOfflineFlowDocument } from '../../api/offline';
import {
    readRecoverySnapshot,
    removeRecoverySnapshot,
    writeRecoverySnapshot,
    type RecoverySnapshot,
} from './recoverySnapshotStore';
import { useFlowEditingSession } from './useFlowEditingSession';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        getOfflineFlowDocument: vi.fn(),
    };
});

vi.mock('./recoverySnapshotStore', () => ({
    readRecoverySnapshot: vi.fn(),
    writeRecoverySnapshot: vi.fn(),
    removeRecoverySnapshot: vi.fn(),
}));

function makeFlowDocument(overrides?: Partial<OfflineFlowDocument>): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/jack/demo/flow.yaml',
        flowId: 'demo',
        namespace: 'jack.demo',
        documentHash: 'server-hash',
        documentUpdatedAt: 10,
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes: [
                    {
                        taskId: 'shell_node_1',
                        kind: 'SHELL',
                        scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                        scriptContent: 'server content',
                    },
                ],
            },
        ],
        edges: [],
        layout: {
            shell_node_1: { x: 0, y: 0 },
        },
        ...overrides,
    };
}

function makeSnapshot(document: OfflineFlowDocument): RecoverySnapshot {
    return {
        document,
        baseDocumentHash: 'server-hash',
        baseDocumentUpdatedAt: 10,
        selectedNodeId: 'shell_node_1',
        selectedTaskIds: ['shell_node_1'],
        updatedAt: 100,
    };
}

function renderSessionHook() {
    return renderHook(() => useFlowEditingSession({
        groupId: 1,
        loadScheduleSnapshot: vi.fn().mockResolvedValue(undefined),
        showFeedback: vi.fn(),
    }));
}

describe('useFlowEditingSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(readRecoverySnapshot).mockReturnValue(null);
    });

    it('opens a Flow using a matching recovery snapshot before the server draft', async () => {
        const serverDocument = makeFlowDocument();
        const recoveredDocument = makeFlowDocument({
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'shell_node_1',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                            scriptContent: 'recovered content',
                        },
                    ],
                },
            ],
        });
        const loadScheduleSnapshot = vi.fn().mockResolvedValue(undefined);
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(serverDocument);
        vi.mocked(readRecoverySnapshot).mockReturnValue(makeSnapshot(recoveredDocument));

        const { result } = renderHook(() => useFlowEditingSession({
            groupId: 1,
            loadScheduleSnapshot,
            showFeedback: vi.fn(),
        }));

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        expect(result.current.flowDocument?.stages[0].nodes[0].scriptContent).toBe('recovered content');
        expect(loadScheduleSnapshot).toHaveBeenCalledWith('_flows/jack/demo/flow.yaml');
    });

    it('leaves a dirty Flow by flushing the pending node editor draft into a recovery snapshot', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument());
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        act(() => {
            result.current.openNodeEditor('shell_node_1');
            result.current.updateNodeEditorContent('edited content');
        });

        act(() => {
            result.current.leaveCurrentFlow();
        });

        expect(writeRecoverySnapshot).toHaveBeenCalledWith(
            1,
            '_flows/jack/demo/flow.yaml',
            expect.objectContaining({
                document: expect.objectContaining({
                    stages: [
                        expect.objectContaining({
                            nodes: [
                                expect.objectContaining({
                                    taskId: 'shell_node_1',
                                    scriptContent: 'edited content',
                                }),
                            ],
                        }),
                    ],
                }),
            }),
        );
    });

    it('resetAfterBranchSwitch clears active path, draft session, loading, node editor state, and pending draft', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument());
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        act(() => {
            result.current.openNodeEditor('shell_node_1');
            result.current.updateNodeEditorContent('edited content');
            result.current.resetAfterBranchSwitch();
        });

        expect(result.current.activeFlowPath).toBeNull();
        expect(result.current.flowDocument).toBeNull();
        expect(result.current.draftSession).toBeNull();
        expect(result.current.flowLoading).toBe(false);
        expect(result.current.nodeEditorOpen).toBe(false);
        expect(result.current.nodeEditorContent).toBe('');
        expect(result.current.flushPendingNodeEditorDraftForSave()).toBeNull();
        expect(removeRecoverySnapshot).not.toHaveBeenCalled();
    });

    it('blocks opening a different dirty current Flow when not forced or allowed and does not fetch the next document', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument());
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        act(() => {
            result.current.openNodeEditor('shell_node_1');
            result.current.stageNodeEditorDraft('dirty content');
        });

        let opened = true;
        await act(async () => {
            opened = await result.current.openFlowDocument('_flows/jack/next/flow.yaml');
        });

        expect(opened).toBe(false);
        expect(result.current.activeFlowPath).toBe('_flows/jack/demo/flow.yaml');
        expect(getOfflineFlowDocument).toHaveBeenCalledTimes(1);
    });

    it('opens the server draft when preferRecoverySnapshot is false even if a matching recovery snapshot exists', async () => {
        const serverDocument = makeFlowDocument();
        const recoveredDocument = makeFlowDocument({
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'shell_node_1',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                            scriptContent: 'recovered content',
                        },
                    ],
                },
            ],
        });
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(serverDocument);
        vi.mocked(readRecoverySnapshot).mockReturnValue(makeSnapshot(recoveredDocument));
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml', { preferRecoverySnapshot: false });
        });

        expect(result.current.flowDocument?.stages[0].nodes[0].scriptContent).toBe('server content');
    });

    it('creates a conflict for a stale recovery snapshot instead of applying it as the working draft', async () => {
        const serverDocument = makeFlowDocument();
        const staleDocument = makeFlowDocument({
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'shell_node_1',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                            scriptContent: 'stale local content',
                        },
                    ],
                },
            ],
        });
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(serverDocument);
        vi.mocked(readRecoverySnapshot).mockReturnValue({
            ...makeSnapshot(staleDocument),
            baseDocumentHash: 'older-hash',
            baseDocumentUpdatedAt: 1,
        });
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        expect(result.current.flowDocument?.stages[0].nodes[0].scriptContent).toBe('server content');
        expect(result.current.draftSession?.conflict).toEqual(expect.objectContaining({
            kind: 'stale-recovery',
        }));
    });

    it('preserves datasource fields from staged node editor draft in a recovery snapshot when leaving', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument());
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        act(() => {
            result.current.openNodeEditor('shell_node_1');
            result.current.stageNodeEditorDraft('select * from demo', 42, 'MYSQL');
            result.current.leaveCurrentFlow();
        });

        expect(writeRecoverySnapshot).toHaveBeenCalledWith(
            1,
            '_flows/jack/demo/flow.yaml',
            expect.objectContaining({
                document: expect.objectContaining({
                    stages: [
                        expect.objectContaining({
                            nodes: [
                                expect.objectContaining({
                                    taskId: 'shell_node_1',
                                    scriptContent: 'select * from demo',
                                    dataSourceId: 42,
                                    dataSourceType: 'MYSQL',
                                }),
                            ],
                        }),
                    ],
                }),
            }),
        );
    });

    it('renames a node through the editing session and preserves selection', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument({
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'shell_node_1',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                            scriptContent: 'server content',
                        },
                        {
                            taskId: 'shell_node_2',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_2.sh',
                            scriptContent: 'second content',
                        },
                    ],
                },
            ],
            edges: [{ source: 'shell_node_1', target: 'shell_node_2' }],
            layout: {
                shell_node_1: { x: 10, y: 20 },
                shell_node_2: { x: 30, y: 40 },
            },
        }));
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });
        act(() => {
            result.current.setSelectedNodeId('shell_node_1');
            result.current.setSelectedTaskIds(['shell_node_1']);
        });

        act(() => {
            result.current.renameNode('shell_node_1', 'renamed_node');
        });

        expect(result.current.flowDocument?.stages[0].nodes.map((node) => node.taskId)).toEqual([
            'renamed_node',
            'shell_node_2',
        ]);
        expect(result.current.flowDocument?.stages[0].nodes[0].scriptPath).toBe('scripts/jack/demo/renamed_node.sh');
        expect(result.current.flowDocument?.edges).toEqual([{ source: 'renamed_node', target: 'shell_node_2' }]);
        expect(result.current.flowDocument?.layout).toEqual({
            renamed_node: { x: 10, y: 20 },
            shell_node_2: { x: 30, y: 40 },
        });
        expect(result.current.activeNodeId).toBe('renamed_node');
        expect(result.current.selectedTaskIds).toEqual(['renamed_node']);
    });

    it('adds a shell node through the editing session', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument());
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        act(() => {
            result.current.addNode('SHELL', { x: 100, y: 200 });
        });

        const nodes = result.current.flowDocument?.stages[0].nodes ?? [];
        expect(nodes.map((node) => node.taskId)).toEqual(['shell_node_1', 'shell_node_2']);
        expect(nodes[1]).toEqual(expect.objectContaining({
            taskId: 'shell_node_2',
            kind: 'SHELL',
            scriptPath: 'scripts/jack/demo/shell_node_2.sh',
        }));
        expect(result.current.flowDocument?.layout.shell_node_2).toEqual({ x: 100, y: 200 });
        expect(result.current.activeNodeId).toBe('shell_node_2');
    });

    it('synchronizes canvas refs immediately after hook-owned add and rename commands', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument({
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'shell_node_1',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                            scriptContent: 'server content',
                        },
                        {
                            taskId: 'shell_node_2',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_2.sh',
                            scriptContent: 'second content',
                        },
                    ],
                },
            ],
            edges: [{ source: 'shell_node_1', target: 'shell_node_2' }],
            layout: {
                shell_node_1: { x: 10, y: 20 },
                shell_node_2: { x: 30, y: 40 },
            },
        }));
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        result.current.canvasNodesRef.current = [
            { id: 'shell_node_1', type: 'flowNode', position: { x: 10, y: 20 }, data: {} },
            { id: 'shell_node_2', type: 'flowNode', position: { x: 30, y: 40 }, data: {} },
        ];
        result.current.canvasEdgesRef.current = [
            { id: 'shell_node_1->shell_node_2', source: 'shell_node_1', target: 'shell_node_2' },
        ];

        act(() => {
            result.current.addNode('SHELL', { x: 100, y: 200 });
        });

        expect(result.current.canvasNodesRef.current.map((node) => node.id)).toEqual([
            'shell_node_1',
            'shell_node_2',
            'shell_node_3',
        ]);
        expect(result.current.canvasNodesRef.current.find((node) => node.id === 'shell_node_3')?.position).toEqual({
            x: 100,
            y: 200,
        });
        expect(result.current.canvasEdgesRef.current.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
            'shell_node_1->shell_node_2',
        ]);

        act(() => {
            result.current.renameNode('shell_node_1', 'renamed_node');
        });

        expect(result.current.canvasNodesRef.current.map((node) => node.id)).toEqual([
            'renamed_node',
            'shell_node_2',
            'shell_node_3',
        ]);
        expect(result.current.canvasNodesRef.current.find((node) => node.id === 'renamed_node')?.position).toEqual({
            x: 10,
            y: 20,
        });
        expect(result.current.canvasEdgesRef.current.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
            'renamed_node->shell_node_2',
        ]);
    });

    it('removes a node through canvas node changes and clears stale pending editor draft', async () => {
        vi.mocked(getOfflineFlowDocument).mockResolvedValue(makeFlowDocument({
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'shell_node_1',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                            scriptContent: 'server content',
                        },
                        {
                            taskId: 'shell_node_2',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_2.sh',
                            scriptContent: 'second content',
                        },
                    ],
                },
            ],
            edges: [{ source: 'shell_node_1', target: 'shell_node_2' }],
            layout: {
                shell_node_1: { x: 0, y: 0 },
                shell_node_2: { x: 200, y: 0 },
            },
        }));
        const { result } = renderSessionHook();

        await act(async () => {
            await result.current.openFlowDocument('_flows/jack/demo/flow.yaml');
        });

        act(() => {
            result.current.openNodeEditor('shell_node_1');
            result.current.updateNodeEditorContent('edited but removed');
        });

        const remainingNodes: Node[] = [
            {
                id: 'shell_node_2',
                type: 'flowNode',
                position: { x: 200, y: 0 },
                data: {},
            },
        ];
        act(() => {
            result.current.updateCanvasNodes(remainingNodes);
        });

        expect(result.current.nodeEditorOpen).toBe(false);
        expect(result.current.nodeEditorContent).toBe('');
        expect(result.current.activeNodeId).toBe('shell_node_2');
        expect(result.current.selectedTaskIds).toEqual([]);
        expect(result.current.flowDocument?.stages[0].nodes.map((node) => node.taskId)).toEqual(['shell_node_2']);
        expect(result.current.flowDocument?.edges).toEqual([]);
        expect(result.current.flushPendingNodeEditorDraftForSave()?.nodeOverride).toBeUndefined();

        act(() => {
            result.current.leaveCurrentFlow();
        });

        expect(writeRecoverySnapshot).toHaveBeenCalledWith(
            1,
            '_flows/jack/demo/flow.yaml',
            expect.objectContaining({
                document: expect.objectContaining({
                    stages: [
                        expect.objectContaining({
                            nodes: [
                                expect.objectContaining({
                                    taskId: 'shell_node_2',
                                    scriptContent: 'second content',
                                }),
                            ],
                        }),
                    ],
                    edges: [],
                }),
            }),
        );
    });
});
