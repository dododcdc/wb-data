import type { Edge, Node } from '@xyflow/react';
import type { NodePosition, OfflineFlowDocument, OfflineFlowEdge } from '../../api/offline';

function sortObjectEntries<T>(record: Record<string, T>) {
    return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

export function buildLayoutFromCanvasNodes(nodes: Node[]): Record<string, NodePosition> {
    const layout: Record<string, NodePosition> = {};
    for (const node of nodes) {
        layout[node.id] = {
            x: node.position.x,
            y: node.position.y,
        };
    }
    return layout;
}

export function buildEdgesFromCanvasEdges(edges: Edge[]): OfflineFlowEdge[] {
    return edges
        .map((edge) => ({
            source: edge.source,
            target: edge.target,
        }))
        .sort((left, right) => `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`));
}

export function buildFlowDocumentSignature(document: OfflineFlowDocument | null) {
    if (!document) return '';

    return JSON.stringify({
        stages: document.stages.map((stage) => ({
            stageId: stage.stageId,
            parallel: stage.parallel,
            nodes: stage.nodes.map((node) => ({
                taskId: node.taskId,
                kind: node.kind,
                scriptPath: node.scriptPath,
                scriptContent: node.scriptContent,
                dataSourceId: node.dataSourceId ?? null,
                dataSourceType: node.dataSourceType ?? null,
            })),
        })),
        edges: buildEdgesFromCanvasEdges(document.edges.map((edge) => ({
            id: `${edge.source}->${edge.target}`,
            source: edge.source,
            target: edge.target,
            position: { x: 0, y: 0 },
            data: {},
        }))),
        layout: sortObjectEntries(document.layout).map(([taskId, position]) => ({
            taskId,
            x: position.x,
            y: position.y,
        })),
    });
}

export function applyCanvasStateToDocument(
    document: OfflineFlowDocument,
    nodes: Node[],
    edges: Edge[],
): OfflineFlowDocument {
    const remainingNodeIds = new Set(nodes.map((node) => node.id));

    return {
        ...document,
        stages: document.stages
            .map((stage) => ({
                ...stage,
                nodes: stage.nodes
                    .filter((node) => remainingNodeIds.has(node.taskId))
                    .map((node) => ({ ...node })),
            }))
            .filter((stage) => stage.nodes.length > 0),
        edges: buildEdgesFromCanvasEdges(edges),
        layout: buildLayoutFromCanvasNodes(nodes),
    };
}
