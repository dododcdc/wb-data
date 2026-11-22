import type { Edge, Node } from '@xyflow/react';
import type { NodePosition, OfflineFlowDocument } from '../../../api/offline';
import { autoLayout } from '../canvas/dagUtils';

export const COMPARE_NODE_WIDTH = 260;
export const COMPARE_NODE_HEIGHT = 52;

function collectOrderedNodes(document: OfflineFlowDocument): Node[] {
    return document.stages.flatMap((stage) => stage.nodes).map((node) => ({
        id: node.taskId,
        position: { x: 0, y: 0 },
        data: {},
    }));
}

export function buildCompareLayout(document: OfflineFlowDocument): Record<string, NodePosition> {
    const nodes = collectOrderedNodes(document);
    const edges: Edge[] = document.edges.map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
    }));
    const positions: Record<string, NodePosition> = {};
    for (const node of autoLayout(nodes, edges, 'TB', { nodeWidth: COMPARE_NODE_WIDTH, nodeHeight: COMPARE_NODE_HEIGHT })) {
        positions[node.id] = node.position;
    }
    return positions;
}

function wouldEdgeCreateCycle(edges: Edge[], source: string, target: string): boolean {
    if (source === target) return true;
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
        const list = adj.get(edge.source) ?? [];
        list.push(edge.target);
        adj.set(edge.source, list);
    }
    const queue = [target];
    const visited = new Set<string>([target]);
    while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === source) return true;
        for (const next of adj.get(curr) ?? []) {
            if (!visited.has(next)) {
                visited.add(next);
                queue.push(next);
            }
        }
    }
    return false;
}

/**
 * Computes one deterministic Top-to-Bottom topological layout (matching FlowCanvasNode conventions)
 * over the union of both revisions' nodes and edges so corresponding nodes align identically across panes.
 */
export function buildUnifiedCompareLayout(
    baseDoc: OfflineFlowDocument,
    targetDoc: OfflineFlowDocument,
): Record<string, NodePosition> {
    const orderedIds: string[] = [];
    const seenIds = new Set<string>();
    for (const doc of [baseDoc, targetDoc]) {
        for (const stage of doc.stages ?? []) {
            for (const node of stage.nodes ?? []) {
                if (!seenIds.has(node.taskId)) {
                    seenIds.add(node.taskId);
                    orderedIds.push(node.taskId);
                }
            }
        }
    }

    const unionNodes: Node[] = orderedIds.map((id) => ({
        id,
        position: { x: 0, y: 0 },
        data: {},
    }));

    const unionEdges: Edge[] = [];
    const seenEdgeKeys = new Set<string>();
    for (const edge of [...(baseDoc.edges ?? []), ...(targetDoc.edges ?? [])]) {
        if (!seenIds.has(edge.source) || !seenIds.has(edge.target)) continue;
        const key = `${edge.source}->${edge.target}`;
        if (seenEdgeKeys.has(key) || wouldEdgeCreateCycle(unionEdges, edge.source, edge.target)) continue;
        seenEdgeKeys.add(key);
        unionEdges.push({ id: key, source: edge.source, target: edge.target });
    }

    const positions: Record<string, NodePosition> = {};
    for (const node of autoLayout(unionNodes, unionEdges, 'TB', {
        nodeWidth: COMPARE_NODE_WIDTH,
        nodeHeight: COMPARE_NODE_HEIGHT,
    })) {
        positions[node.id] = node.position;
    }

    return positions;
}
