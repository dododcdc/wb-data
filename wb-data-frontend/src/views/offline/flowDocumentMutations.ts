import type { Edge, Node } from '@xyflow/react';
import type {
    NodePosition,
    OfflineFlowDocument,
    OfflineFlowNode,
    OfflineFlowNodeKind,
} from '../../api/offline';
import {
    applyCanvasStateToDocument,
    buildEdgesFromCanvasEdges,
} from './flowCanvasState';
import {
    getOfflineNodeDefaultScript,
    getOfflineNodeScriptExtension,
} from './offlineNodeKinds';
import { resolveSelectionStateAfterAddingNode } from './nodeSelectionState';

export type RenameFlowNodeFailureReason =
    | 'empty'
    | 'same'
    | 'duplicate'
    | 'invalid-format'
    | 'missing-node';

export type RenameFlowNodeResult =
    | {
        ok: true;
        document: OfflineFlowDocument;
        nextActiveNodeId: string | null;
        nextSelectedTaskIds: string[];
    }
    | { ok: false; reason: RenameFlowNodeFailureReason };

export type AddFlowNodeResult =
    | {
        ok: true;
        document: OfflineFlowDocument;
        node: OfflineFlowNode;
        nextActiveNodeId: string;
        nextSelectedTaskIds: string[];
    }
    | { ok: false; reason: 'max-nodes' };

export interface RenameFlowNodeInput {
    document: OfflineFlowDocument;
    oldId: string;
    newId: string;
    activeNodeId: string | null;
    selectedTaskIds: string[];
}

export interface AddFlowNodeInput {
    document: OfflineFlowDocument;
    kind: OfflineFlowNodeKind;
    position: NodePosition;
    selectedTaskIds: string[];
    maxNodes?: number;
}

export interface ApplyFlowCanvasNodesInput {
    document: OfflineFlowDocument;
    nodes: Node[];
    edges?: Edge[];
    activeNodeId: string | null;
    selectedTaskIds: string[];
}

const NEW_NODE_OFFSET = 48;

function cloneFlowDocument(document: OfflineFlowDocument): OfflineFlowDocument {
    return {
        ...document,
        stages: document.stages.map((stage) => ({
            ...stage,
            nodes: stage.nodes.map((node) => ({ ...node })),
        })),
        edges: (document.edges ?? []).map((edge) => ({ ...edge })),
        layout: Object.fromEntries(
            Object.entries(document.layout ?? {}).map(([taskId, position]) => [taskId, { ...position }]),
        ),
        schedule: document.schedule ? { ...document.schedule } : undefined,
    };
}

function toCanvasEdge(edge: { source: string; target: string }): Edge {
    return {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
    };
}

function updateScriptPathForRename(scriptPath: string, oldId: string, newId: string) {
    const lastSlashIndex = scriptPath.lastIndexOf('/');
    const directory = lastSlashIndex >= 0 ? scriptPath.slice(0, lastSlashIndex + 1) : '';
    const fileName = lastSlashIndex >= 0 ? scriptPath.slice(lastSlashIndex + 1) : scriptPath;
    const oldFileNameSegment = `${oldId}.`;

    if (!fileName.includes(oldFileNameSegment)) {
        return scriptPath;
    }

    return `${directory}${fileName.replace(oldFileNameSegment, `${newId}.`)}`;
}

function buildScriptPath(documentPath: string, taskId: string, kind: OfflineFlowNodeKind) {
    const extension = getOfflineNodeScriptExtension(kind);
    const normalizedPath = documentPath.replace(/\\/g, '/');
    const flowDirectory = normalizedPath.endsWith('/flow.yaml')
        ? normalizedPath.slice(0, -'/flow.yaml'.length)
        : normalizedPath.replace(/\/[^/]*$/, '');
    const scriptDirectory = flowDirectory.replace(/^_flows\//, 'scripts/');

    return `${scriptDirectory}/${taskId}.${extension}`;
}

function filterCanvasEdgesToNodeIds(edges: Edge[], nodeIds: Set<string>) {
    return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function positionsOverlap(left: NodePosition, right: NodePosition) {
    return Math.abs(left.x - right.x) < 1 && Math.abs(left.y - right.y) < 1;
}

function resolveAvailableNodePosition(document: OfflineFlowDocument, position: NodePosition): NodePosition {
    const occupiedPositions = Object.values(document.layout ?? {});
    let candidate = { ...position };

    for (let attempt = 0; attempt <= occupiedPositions.length; attempt += 1) {
        if (!occupiedPositions.some((occupied) => positionsOverlap(occupied, candidate))) {
            return candidate;
        }
        candidate = {
            x: position.x + NEW_NODE_OFFSET * (attempt + 1),
            y: position.y + NEW_NODE_OFFSET * (attempt + 1),
        };
    }

    return candidate;
}

function mergeCanvasLayout(document: OfflineFlowDocument, nodes: Node[]): Record<string, NodePosition> {
    const documentNodeIds = new Set(flattenFlowDocumentNodes(document).map((node) => node.taskId));
    const layout: Record<string, NodePosition> = {};

    for (const nodeId of documentNodeIds) {
        const currentPosition = document.layout?.[nodeId];
        if (currentPosition) {
            layout[nodeId] = { ...currentPosition };
        }
    }

    for (const node of nodes) {
        if (!documentNodeIds.has(node.id)) {
            continue;
        }
        layout[node.id] = {
            x: node.position.x,
            y: node.position.y,
        };
    }

    return layout;
}

export function flattenFlowDocumentNodes(document: OfflineFlowDocument | null): OfflineFlowNode[] {
    return document?.stages.flatMap((stage) => stage.nodes) ?? [];
}

export function resolveFlowSelectedNodeId(
    document: OfflineFlowDocument | null,
    candidate: string | null,
): string | null {
    const nodes = flattenFlowDocumentNodes(document);
    if (nodes.length === 0) return null;
    if (candidate && nodes.some((node) => node.taskId === candidate)) {
        return candidate;
    }
    return nodes[0].taskId;
}

export function resolveFlowSelectedTaskIds(
    document: OfflineFlowDocument | null,
    candidates: string[],
): string[] {
    const validIds = new Set(flattenFlowDocumentNodes(document).map((node) => node.taskId));
    return candidates.filter((taskId, index) => validIds.has(taskId) && candidates.indexOf(taskId) === index);
}

export function renameFlowNode(input: RenameFlowNodeInput): RenameFlowNodeResult {
    const cleanNewId = input.newId.trim();
    if (!cleanNewId) {
        return { ok: false, reason: 'empty' };
    }

    const nodes = flattenFlowDocumentNodes(input.document);
    const nodeExists = nodes.some((node) => node.taskId === input.oldId);
    if (!nodeExists) {
        return { ok: false, reason: 'missing-node' };
    }

    if (input.oldId === cleanNewId) {
        return { ok: false, reason: 'same' };
    }

    if (nodes.some((node) => node.taskId === cleanNewId)) {
        return { ok: false, reason: 'duplicate' };
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleanNewId)) {
        return { ok: false, reason: 'invalid-format' };
    }

    const document = cloneFlowDocument(input.document);
    document.stages = document.stages.map((stage) => ({
        ...stage,
        nodes: stage.nodes.map((node) => {
            if (node.taskId !== input.oldId) {
                return node;
            }

            return {
                ...node,
                taskId: cleanNewId,
                ...(node.scriptPath
                    ? { scriptPath: updateScriptPathForRename(node.scriptPath, input.oldId, cleanNewId) }
                    : {}),
            };
        }),
    }));
    document.edges = (document.edges ?? []).map((edge) => ({
        source: edge.source === input.oldId ? cleanNewId : edge.source,
        target: edge.target === input.oldId ? cleanNewId : edge.target,
    }));

    const nextLayout: Record<string, NodePosition> = {};
    for (const [taskId, position] of Object.entries(document.layout ?? {})) {
        nextLayout[taskId === input.oldId ? cleanNewId : taskId] = { ...position };
    }
    document.layout = nextLayout;

    const nextActiveNodeId = input.activeNodeId === input.oldId
        ? cleanNewId
        : resolveFlowSelectedNodeId(document, input.activeNodeId);
    const nextSelectedTaskIds = resolveFlowSelectedTaskIds(
        document,
        input.selectedTaskIds.map((taskId) => taskId === input.oldId ? cleanNewId : taskId),
    );

    return {
        ok: true,
        document,
        nextActiveNodeId,
        nextSelectedTaskIds,
    };
}

export function addFlowNode(input: AddFlowNodeInput): AddFlowNodeResult {
    const maxNodes = input.maxNodes ?? 20;
    const existingNodes = flattenFlowDocumentNodes(input.document);
    if (existingNodes.length >= maxNodes) {
        return { ok: false, reason: 'max-nodes' };
    }

    const existingIds = new Set(existingNodes.map((node) => node.taskId));
    let index = 1;
    let newTaskId = `${input.kind.toLowerCase()}_node_${index}`;
    while (existingIds.has(newTaskId)) {
        index += 1;
        newTaskId = `${input.kind.toLowerCase()}_node_${index}`;
    }

    const node: OfflineFlowNode = {
        taskId: newTaskId,
        kind: input.kind,
        scriptPath: buildScriptPath(input.document.path, newTaskId, input.kind),
        scriptContent: getOfflineNodeDefaultScript(input.kind),
    };
    const document = cloneFlowDocument(input.document);

    if (document.stages.length === 0) {
        document.stages = [{
            stageId: 'main',
            parallel: false,
            nodes: [node],
        }];
    } else {
        document.stages = document.stages.map((stage, stageIndex) => stageIndex === 0
            ? { ...stage, nodes: [...stage.nodes, node] }
            : stage);
    }
    document.layout = {
        ...(document.layout ?? {}),
        [newTaskId]: resolveAvailableNodePosition(document, input.position),
    };
    const { nextActiveNodeId, nextSelectedTaskIds } = resolveSelectionStateAfterAddingNode({
        currentSelectedTaskIds: input.selectedTaskIds,
        newTaskId,
    });

    return {
        ok: true,
        document,
        node,
        nextActiveNodeId,
        nextSelectedTaskIds,
    };
}

export function applyFlowCanvasNodes(input: ApplyFlowCanvasNodesInput): {
    document: OfflineFlowDocument;
    nextActiveNodeId: string | null;
    nextSelectedTaskIds: string[];
} {
    const remainingNodeIds = new Set(input.nodes.map((node) => node.id));
    const sourceEdges = input.edges ?? (input.document.edges ?? []).map(toCanvasEdge);
    const nextDocument = applyCanvasStateToDocument(
        cloneFlowDocument(input.document),
        input.nodes,
        filterCanvasEdgesToNodeIds(sourceEdges, remainingNodeIds),
    );

    return {
        document: nextDocument,
        nextActiveNodeId: resolveFlowSelectedNodeId(nextDocument, input.activeNodeId),
        nextSelectedTaskIds: resolveFlowSelectedTaskIds(nextDocument, input.selectedTaskIds),
    };
}

export function applyFlowCanvasEdges(document: OfflineFlowDocument, edges: Edge[]): OfflineFlowDocument {
    return {
        ...cloneFlowDocument(document),
        edges: buildEdgesFromCanvasEdges(edges),
    };
}

export function applyFlowCanvasLayout(document: OfflineFlowDocument, nodes: Node[]): OfflineFlowDocument {
    return {
        ...cloneFlowDocument(document),
        layout: mergeCanvasLayout(document, nodes),
    };
}

export function validateFlowDocumentGraph(
    document: OfflineFlowDocument,
): { valid: true } | { valid: false; reason: 'cycle' | 'disconnected' | 'dangling-edge' } {
    const nodeIds = flattenFlowDocumentNodes(document).map((node) => node.taskId);
    const nodeIdSet = new Set(nodeIds);
    const validEdges = document.edges ?? [];

    if (validEdges.some((edge) => !nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target))) {
        return { valid: false, reason: 'dangling-edge' };
    }

    const outgoing = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
    const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));

    for (const edge of validEdges) {
        outgoing.get(edge.source)?.push(edge.target);
        indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }

    const queue = nodeIds.filter((nodeId) => indegree.get(nodeId) === 0);
    let visitedCount = 0;
    for (let index = 0; index < queue.length; index += 1) {
        const nodeId = queue[index];
        visitedCount += 1;
        for (const target of outgoing.get(nodeId) ?? []) {
            const nextIndegree = (indegree.get(target) ?? 0) - 1;
            indegree.set(target, nextIndegree);
            if (nextIndegree === 0) {
                queue.push(target);
            }
        }
    }

    if (visitedCount !== nodeIds.length) {
        return { valid: false, reason: 'cycle' };
    }

    if (nodeIds.length <= 1) {
        return { valid: true };
    }

    const undirected = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
    for (const edge of validEdges) {
        undirected.get(edge.source)?.add(edge.target);
        undirected.get(edge.target)?.add(edge.source);
    }

    const connected = new Set<string>();
    const stack = [nodeIds[0]];
    connected.add(nodeIds[0]);
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const neighbor of undirected.get(current) ?? []) {
            if (!connected.has(neighbor)) {
                connected.add(neighbor);
                stack.push(neighbor);
            }
        }
    }

    if (connected.size !== nodeIds.length) {
        return { valid: false, reason: 'disconnected' };
    }

    return { valid: true };
}
