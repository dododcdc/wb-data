import type { Edge, Node } from '@xyflow/react';
import type { OperationsRerunGraphEdge, OperationsRerunGraphNode } from '../../api/operations';
import { autoLayout } from '../../lib/dagLayout';

export const RERUN_NODE_WIDTH = 244;
export const RERUN_NODE_HEIGHT = 68;

export interface ToggleRerunSelectionResult {
    nextSelected: Set<string>;
    autoAdded: string[];
    autoRemoved: string[];
    blockedReason: 'required' | null;
}

function buildAdjacency(edges: readonly OperationsRerunGraphEdge[], forward: boolean): Map<string, string[]> {
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
        const from = forward ? edge.source : edge.target;
        const to = forward ? edge.target : edge.source;
        const list = adj.get(from);
        if (list) {
            list.push(to);
        } else {
            adj.set(from, [to]);
        }
    }
    return adj;
}

function bfs(seeds: Iterable<string>, adj: Map<string, string[]>, includeSeeds: boolean): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const seed of seeds) {
        if (includeSeeds) {
            if (!visited.has(seed)) {
                visited.add(seed);
                queue.push(seed);
            }
        } else {
            for (const neighbor of adj.get(seed) ?? []) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
    }
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const neighbor of adj.get(current) ?? []) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    return visited;
}

function orderIds(ids: Iterable<string>, orderedNodeIds?: readonly string[]): string[] {
    const set = ids instanceof Set ? ids : new Set(ids);
    if (!orderedNodeIds || orderedNodeIds.length === 0) {
        return Array.from(set);
    }
    const ordered: string[] = [];
    for (const id of orderedNodeIds) {
        if (set.has(id)) {
            ordered.push(id);
        }
    }
    for (const id of set) {
        if (!ordered.includes(id)) {
            ordered.push(id);
        }
    }
    return ordered;
}

/**
 * 切换部分重跑节点选区并维持 DAG 路径凸性：
 * 1) 必选节点（失败/未执行及其全部下游）锁定不可取消；
 * 2) 勾选较早的上游节点时，自动联动勾选与当前已选集合之间的中间路径节点；
 * 3) 取消勾选某个节点且其严格下游仍有选中节点时，同步取消该节点严格上游中可取消的节点，防止中间断层。
 */
export function toggleRerunNodeSelection(
    currentSelected: ReadonlySet<string>,
    taskId: string,
    edges: readonly OperationsRerunGraphEdge[],
    requiredIds: ReadonlySet<string>,
    orderedNodeIds?: readonly string[],
): ToggleRerunSelectionResult {
    if (requiredIds.has(taskId)) {
        return {
            nextSelected: new Set(currentSelected),
            autoAdded: [],
            autoRemoved: [],
            blockedReason: 'required',
        };
    }

    const successors = buildAdjacency(edges, true);
    const predecessors = buildAdjacency(edges, false);

    if (!currentSelected.has(taskId)) {
        const candidate = new Set(currentSelected);
        candidate.add(taskId);
        const descendants = bfs(candidate, successors, true);
        const ancestors = bfs(candidate, predecessors, true);

        const nextSelected = new Set(candidate);
        const added: string[] = [];
        for (const nodeId of descendants) {
            if (ancestors.has(nodeId) && !candidate.has(nodeId)) {
                nextSelected.add(nodeId);
                added.push(nodeId);
            }
        }
        return {
            nextSelected,
            autoAdded: orderIds(added, orderedNodeIds),
            autoRemoved: [],
            blockedReason: null,
        };
    }

    const nextSelected = new Set(currentSelected);
    nextSelected.delete(taskId);
    const strictDescendants = bfs([taskId], successors, false);
    const hasSelectedDescendant = Array.from(strictDescendants).some((id) => nextSelected.has(id));
    if (!hasSelectedDescendant) {
        return {
            nextSelected,
            autoAdded: [],
            autoRemoved: [],
            blockedReason: null,
        };
    }

    const strictAncestors = bfs([taskId], predecessors, false);
    const removed: string[] = [];
    for (const ancestorId of strictAncestors) {
        if (nextSelected.has(ancestorId) && !requiredIds.has(ancestorId)) {
            nextSelected.delete(ancestorId);
            removed.push(ancestorId);
        }
    }
    return {
        nextSelected,
        autoAdded: [],
        autoRemoved: orderIds(removed, orderedNodeIds),
        blockedReason: null,
    };
}

export function computeRerunCanvasLayout(
    nodes: readonly OperationsRerunGraphNode[],
    edges: readonly OperationsRerunGraphEdge[],
): Record<string, { x: number; y: number }> {
    if (nodes.length === 0) {
        return {};
    }
    const rfNodes: Node[] = nodes.map((node) => ({
        id: node.taskId,
        position: { x: 0, y: 0 },
        data: {},
    }));
    const rfEdges: Edge[] = edges.map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
    }));
    const positions: Record<string, { x: number; y: number }> = {};
    for (const layoutNode of autoLayout(rfNodes, rfEdges, 'TB', {
        nodeWidth: RERUN_NODE_WIDTH,
        nodeHeight: RERUN_NODE_HEIGHT,
    })) {
        positions[layoutNode.id] = layoutNode.position;
    }
    return positions;
}
