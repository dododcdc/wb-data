import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { OfflineFlowDocument } from '../../api/offline';
import {
    addFlowNode,
    applyFlowCanvasEdges,
    applyFlowCanvasLayout,
    applyFlowCanvasNodes,
    flattenFlowDocumentNodes,
    renameFlowNode,
    validateFlowDocumentGraph,
} from './flowDocumentMutations';

type TestOfflineFlowDocument = OfflineFlowDocument & { content: string };

function makeDocument(overrides: Partial<TestOfflineFlowDocument> = {}): TestOfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/jack/demo/flow.yaml',
        flowId: 'demo',
        namespace: 'pg-1',
        content: '',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes: [
                    {
                        taskId: 'shell_node_1',
                        kind: 'SHELL',
                        scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                        scriptContent: 'echo one',
                    },
                    {
                        taskId: 'shell_node_2',
                        kind: 'SHELL',
                        scriptPath: 'scripts/jack/demo/shell_node_2.sh',
                        scriptContent: 'echo two',
                    },
                ],
            },
        ],
        edges: [{ source: 'shell_node_1', target: 'shell_node_2' }],
        layout: {
            shell_node_1: { x: 100, y: 200 },
            shell_node_2: { x: 300, y: 200 },
        },
        schedule: {
            cron: '* * * * *',
            timezone: 'Asia/Singapore',
            enabled: true,
        },
        ...overrides,
    };
}

function canvasNode(id: string, position = { x: 0, y: 0 }): Node {
    return {
        id,
        position,
        data: {},
    };
}

function canvasEdge(source: string, target: string): Edge {
    return {
        id: `${source}->${target}`,
        source,
        target,
    };
}

function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
    expect(result.ok).toBe(true);
    if (!result.ok) {
        throw new Error('Expected mutation to succeed');
    }
    return result as Extract<T, { ok: true }>;
}

describe('renameFlowNode', () => {
    it('renames a node across document nodes, paths, edges, layout, and selection', () => {
        const result = expectOk(renameFlowNode({
            document: makeDocument(),
            oldId: 'shell_node_1',
            newId: 'renamed_node',
            activeNodeId: 'shell_node_1',
            selectedTaskIds: ['shell_node_1', 'shell_node_2'],
        }));

        expect(flattenFlowDocumentNodes(result.document).map((node) => node.taskId)).toEqual([
            'renamed_node',
            'shell_node_2',
        ]);
        expect(flattenFlowDocumentNodes(result.document)[0].scriptPath).toBe('scripts/jack/demo/renamed_node.sh');
        expect(result.document.edges).toEqual([{ source: 'renamed_node', target: 'shell_node_2' }]);
        expect(result.document.layout).toEqual({
            renamed_node: { x: 100, y: 200 },
            shell_node_2: { x: 300, y: 200 },
        });
        expect(result.nextActiveNodeId).toBe('renamed_node');
        expect(result.nextSelectedTaskIds).toEqual(['renamed_node', 'shell_node_2']);
    });

    it('rejects duplicate and invalid targets', () => {
        expect(renameFlowNode({
            document: makeDocument(),
            oldId: 'shell_node_1',
            newId: 'shell_node_2',
            activeNodeId: 'shell_node_1',
            selectedTaskIds: ['shell_node_1'],
        })).toEqual({ ok: false, reason: 'duplicate' });

        expect(renameFlowNode({
            document: makeDocument(),
            oldId: 'shell_node_1',
            newId: 'bad-name',
            activeNodeId: 'shell_node_1',
            selectedTaskIds: ['shell_node_1'],
        })).toEqual({ ok: false, reason: 'invalid-format' });
    });
});

describe('addFlowNode', () => {
    it('adds a transfer node with a sidecar path and preserves existing selections', () => {
        const result = expectOk(addFlowNode({
            document: makeDocument(),
            kind: 'TRANSFER',
            position: { x: 640, y: 320 },
            selectedTaskIds: ['shell_node_1', 'shell_node_2'],
            maxNodes: 20,
        }));

        expect(result.node).toMatchObject({
            taskId: 'transfer_node_1',
            kind: 'TRANSFER',
            scriptPath: 'transfers/demo/transfer_node_1.transfer.json',
            scriptContent: '',
        });
        expect(result.document.layout.transfer_node_1).toEqual({ x: 640, y: 320 });
        expect(result.nextActiveNodeId).toBe('transfer_node_1');
        expect(result.nextSelectedTaskIds).toEqual(['shell_node_1', 'shell_node_2']);
    });

    it('adds a shell node with predictable id, script path, layout, selection, and preserved document fields', () => {
        const position = { x: 640, y: 320 };
        const sourceDocument = makeDocument();
        const result = expectOk(addFlowNode({
            document: sourceDocument,
            kind: 'SHELL',
            position,
            selectedTaskIds: ['shell_node_1', 'shell_node_2'],
            maxNodes: 20,
        }));

        const nodes = flattenFlowDocumentNodes(result.document);
        const addedNode = nodes.find((node) => node.taskId === 'shell_node_3');

        expect(nodes.map((node) => node.taskId)).toEqual(['shell_node_1', 'shell_node_2', 'shell_node_3']);
        expect(addedNode).toMatchObject({
            taskId: 'shell_node_3',
            kind: 'SHELL',
            scriptPath: 'scripts/jack/demo/shell_node_3.sh',
        });
        expect(result.document.layout.shell_node_3).toEqual(position);
        expect(result.nextActiveNodeId).toBe('shell_node_3');
        expect(result.nextSelectedTaskIds).toEqual(['shell_node_1', 'shell_node_2']);
        expect(result.document.schedule).toEqual(sourceDocument.schedule);
        expect(result.document.documentHash).toBe('hash');
        expect(result.document.documentUpdatedAt).toBe(1);
        expect((result.document as TestOfflineFlowDocument).content).toBe('');
    });

    it('offsets a new node when the requested position is already occupied', () => {
        const result = expectOk(addFlowNode({
            document: makeDocument(),
            kind: 'SHELL',
            position: { x: 100, y: 200 },
            selectedTaskIds: [],
            maxNodes: 20,
        }));

        expect(result.document.layout.shell_node_3).toEqual({ x: 148, y: 248 });
    });
});

describe('applyFlowCanvasNodes', () => {
    it('applies canvas node removals and reconciles selection', () => {
        const result = applyFlowCanvasNodes({
            document: makeDocument(),
            nodes: [canvasNode('shell_node_2', { x: 300, y: 200 })],
            edges: [],
            activeNodeId: 'shell_node_1',
            selectedTaskIds: ['shell_node_1', 'shell_node_2'],
        });

        expect(flattenFlowDocumentNodes(result.document).map((node) => node.taskId)).toEqual(['shell_node_2']);
        expect(result.nextActiveNodeId).toBe('shell_node_2');
        expect(result.nextSelectedTaskIds).toEqual(['shell_node_2']);
    });
});

describe('applyFlowCanvasEdges and applyFlowCanvasLayout', () => {
    it('applies sorted minimal canvas edges and node positions', () => {
        const withEdges = applyFlowCanvasEdges(makeDocument(), [
            canvasEdge('shell_node_2', 'shell_node_1'),
        ]);
        const withLayout = applyFlowCanvasLayout(makeDocument(), [
            canvasNode('shell_node_2', { x: 20, y: 40 }),
            canvasNode('shell_node_1', { x: 10, y: 30 }),
        ]);

        expect(withEdges.edges).toEqual([{ source: 'shell_node_2', target: 'shell_node_1' }]);
        expect(withLayout.layout).toEqual({
            shell_node_2: { x: 20, y: 40 },
            shell_node_1: { x: 10, y: 30 },
        });
    });

    it('preserves existing positions when a drag commit only includes moved nodes', () => {
        const withLayout = applyFlowCanvasLayout(makeDocument(), [
            canvasNode('shell_node_2', { x: 420, y: 260 }),
        ]);

        expect(withLayout.layout).toEqual({
            shell_node_1: { x: 100, y: 200 },
            shell_node_2: { x: 420, y: 260 },
        });
    });
});

describe('validateFlowDocumentGraph', () => {
    it('rejects edges whose endpoints are not present in the document', () => {
        expect(validateFlowDocumentGraph(makeDocument({
            edges: [{ source: 'shell_node_1', target: 'missing_node' }],
        }))).toEqual({ valid: false, reason: 'dangling-edge' });
    });

    it('rejects cycles and disconnected graphs while accepting a normal chain', () => {
        expect(validateFlowDocumentGraph(makeDocument({
            edges: [
                { source: 'shell_node_1', target: 'shell_node_2' },
                { source: 'shell_node_2', target: 'shell_node_1' },
            ],
        }))).toEqual({ valid: false, reason: 'cycle' });

        expect(validateFlowDocumentGraph(makeDocument({ edges: [] }))).toEqual({
            valid: false,
            reason: 'disconnected',
        });

        expect(validateFlowDocumentGraph(makeDocument())).toEqual({ valid: true });
    });

    it('rejects a one-node self-loop', () => {
        const oneNodeDocument = makeDocument({
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'shell_node_1',
                            kind: 'SHELL',
                            scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                            scriptContent: 'echo one',
                        },
                    ],
                },
            ],
            edges: [],
            layout: { shell_node_1: { x: 100, y: 200 } },
        });

        expect(validateFlowDocumentGraph(oneNodeDocument)).toEqual({ valid: true });
        expect(validateFlowDocumentGraph(makeDocument({
            ...oneNodeDocument,
            edges: [{ source: 'shell_node_1', target: 'shell_node_1' }],
        }))).toEqual({ valid: false, reason: 'cycle' });
    });
});
