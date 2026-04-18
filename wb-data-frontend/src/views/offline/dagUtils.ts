import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/**
 * Check whether a directed graph (nodes + edges) is acyclic.
 * Uses DFS-based cycle detection with a "recursion stack" (gray/white/black coloring).
 */
export function isAcyclic(nodes: Node[], edges: Edge[]): boolean {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) adj.get(e.source)?.push(e.target);

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const n of nodes) color.set(n.id, WHITE);

    function dfs(id: string): boolean {
        color.set(id, GRAY);
        for (const neighbor of adj.get(id) ?? []) {
            const c = color.get(neighbor) ?? WHITE;
            if (c === GRAY) return true; // back edge → cycle
            if (c === WHITE && dfs(neighbor)) return true;
        }
        color.set(id, BLACK);
        return false;
    }

    for (const n of nodes) {
        if (color.get(n.id) === WHITE && dfs(n.id)) return false;
    }
    return true;
}

/**
 * Check if adding an edge would create a cycle.
 * Used for ReactFlow's `isValidConnection` callback.
 */
export function wouldCreateCycle(
    nodes: Node[],
    edges: Edge[],
    newSource: string,
    newTarget: string,
): boolean {
    if (newSource === newTarget) return true; // self-loop

    // Check if target can reach source via existing edges (would form a back-edge)
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) adj.get(e.source)?.push(e.target);

    // BFS from newTarget: if we can reach newSource, adding newSource→newTarget would create a cycle
    const visited = new Set<string>();
    const queue = [newTarget];
    visited.add(newTarget);
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === newSource) return true;
        for (const neighbor of adj.get(current) ?? []) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    return false;
}

/**
 * Auto-layout nodes using dagre algorithm.
 * Returns a new array of nodes with updated positions.
 */
export function autoLayout(
    nodes: Node[],
    edges: Edge[],
    direction: 'TB' | 'LR' = 'TB',
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

    const nodeWidth = 240;
    const nodeHeight = 56;

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
