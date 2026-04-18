import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { OfflineFlowDocument } from '../../api/offline';
import {
    applyCanvasStateToDocument,
    buildFlowDocumentSignature,
} from './flowCanvasState';

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
                        kind: 'SHELL',
                        scriptPath: 'scripts/extract.sh',
                        scriptContent: 'echo extract',
                    },
                    {
                        taskId: 'load',
                        kind: 'SQL',
                        scriptPath: 'scripts/load.sql',
                        scriptContent: 'select 1;',
                    },
                ],
            },
        ],
        edges: [
            {
                source: 'extract',
                target: 'load',
            },
        ],
        layout: {
            extract: { x: 10, y: 20 },
            load: { x: 30, y: 40 },
        },
    };
}

function createNode(id: string, x: number, y: number): Node {
    return {
        id,
        position: { x, y },
        data: {},
    };
}

function createEdge(source: string, target: string): Edge {
    return {
        id: `${source}->${target}`,
        source,
        target,
    };
}

describe('flowCanvasState', () => {
    it('applies canvas node removal, edges and layout back to the flow document', () => {
        const document = createDocument();

        const nextDocument = applyCanvasStateToDocument(
            document,
            [createNode('load', 200, 220)],
            [],
        );

        expect(nextDocument.stages).toEqual([
            {
                stageId: 'stage-1',
                parallel: false,
                nodes: [
                    {
                        taskId: 'load',
                        kind: 'SQL',
                        scriptPath: 'scripts/load.sql',
                        scriptContent: 'select 1;',
                    },
                ],
            },
        ]);
        expect(nextDocument.edges).toEqual([]);
        expect(nextDocument.layout).toEqual({
            load: { x: 200, y: 220 },
        });
    });

    it('changes the signature when dependencies or node layout changes', () => {
        const document = createDocument();
        const originalSignature = buildFlowDocumentSignature(document);

        const changedDocument = applyCanvasStateToDocument(
            document,
            [createNode('extract', 10, 20), createNode('load', 300, 320)],
            [createEdge('load', 'extract')],
        );

        expect(buildFlowDocumentSignature(changedDocument)).not.toBe(originalSignature);
    });
});
