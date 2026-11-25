import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';

/**
 * Compute deterministic Dagre coordinates for DAG nodes.
 */
export function autoLayout(
    nodes: Node[],
    edges: Edge[],
    direction: 'TB' | 'LR' = 'TB',
    options?: { nodeWidth?: number; nodeHeight?: number },
): Node[] {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: direction,
        nodesep: 60,
        ranksep: 80,
        marginx: 40,
        marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    const nodeWidth = options?.nodeWidth ?? 240;
    const nodeHeight = options?.nodeHeight ?? 56;

    for (const node of nodes) {
        g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    }
    for (const edge of edges) {
        g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    return nodes.map((node) => {
        const pos = g.node(node.id);
        return {
            ...node,
            position: {
                x: pos.x - nodeWidth / 2,
                y: pos.y - nodeHeight / 2,
            },
        };
    });
}
