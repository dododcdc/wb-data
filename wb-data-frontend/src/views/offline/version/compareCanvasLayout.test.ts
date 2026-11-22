import { describe, expect, it } from 'vitest';

import type { OfflineFlowDocument, OfflineFlowNode } from '../../../api/offline';
import {
    buildCompareLayout,
    buildUnifiedCompareLayout,
} from './compareCanvasLayout';

function node(taskId: string): OfflineFlowNode {
    return { taskId, kind: 'SHELL', scriptContent: taskId };
}

function document(edges: OfflineFlowDocument['edges'], layout: OfflineFlowDocument['layout']): OfflineFlowDocument {
    return {
        groupId: 4,
        path: '_flows/example/flow.yaml',
        flowId: 'example',
        namespace: 'pg-4',
        documentHash: 'hash',
        documentUpdatedAt: 0,
        stages: [{ stageId: 'stage-1', parallel: false, nodes: [node('a'), node('b'), node('c'), node('d')] }],
        edges,
        layout,
    };
}

describe('buildCompareLayout', () => {
    it('places downstream nodes at increasing levels without overlap', () => {
        const layout = buildCompareLayout(document(
            [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'd' }],
            {
                a: { x: 999, y: 999 },
                b: { x: 999, y: 999 },
                c: { x: 999, y: 999 },
                d: { x: 999, y: 999 },
            },
        ));

        expect(layout.b.y).toBeGreaterThan(layout.a.y);
        expect(layout.c.y).toBeGreaterThan(layout.b.y);
        expect(layout.d.y).toBe(layout.b.y);
        expect(layout.b.x).not.toBe(layout.d.x);
        expect(new Set(Object.values(layout).map((position) => `${position.x}:${position.y}`)).size).toBe(4);
    });

    it('uses the same computed positions across versions with different saved layouts', () => {
        const edges = [{ source: 'a', target: 'b' }];
        const first = buildCompareLayout(document(edges, { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }));
        const second = buildCompareLayout(document(edges, { a: { x: 900, y: 900 }, b: { x: 900, y: 900 } }));

        expect(first).toEqual(second);
    });

    it('builds unified Top-to-Bottom compare coordinates across divergent saved layouts', () => {
        const edges = [
            { source: 'a', target: 'b' },
            { source: 'b', target: 'c' },
        ];
        const horizontal = document(edges, {
            a: { x: 160, y: 180 },
            b: { x: 480, y: 180 },
            c: { x: 800, y: 180 },
            d: { x: 800, y: 320 },
        });
        const zigzag = document(edges, {
            a: { x: 40, y: 40 },
            b: { x: -131, y: 160 },
            c: { x: 40, y: 312 },
            d: { x: 360, y: 312 },
        });

        const unified = buildUnifiedCompareLayout(horizontal, zigzag);
        expect(unified.b.y).toBeGreaterThan(unified.a.y + 80);
        expect(unified.c.y).toBeGreaterThan(unified.b.y + 80);
    });
});
