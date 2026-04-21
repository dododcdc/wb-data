import type { Edge, Node } from '@xyflow/react';
import type { DebugDocumentExecutionRequest, OfflineFlowDocument } from '../../api/offline';
import { applyCanvasStateToDocument } from './flowCanvasState';

interface BuildDraftExecutionRequestParams {
    groupId: number;
    flowPath: string;
    flowDocument: OfflineFlowDocument;
    canvasNodes: Node[];
    canvasEdges: Edge[];
    selectedTaskIds: string[];
}

function buildFallbackCanvasNodes(flowDocument: OfflineFlowDocument): Node[] {
    return flowDocument.stages.flatMap((stage, stageIndex) => stage.nodes.map((node, nodeIndex) => ({
        id: node.taskId,
        position: flowDocument.layout[node.taskId] ?? { x: 250, y: (stageIndex * stage.nodes.length + nodeIndex) * 120 },
        data: {},
    })));
}

function buildFallbackCanvasEdges(flowDocument: OfflineFlowDocument): Edge[] {
    return flowDocument.edges.map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
    }));
}

export function buildDraftExecutionRequest({
    groupId,
    flowPath,
    flowDocument,
    canvasNodes,
    canvasEdges,
    selectedTaskIds,
}: BuildDraftExecutionRequestParams): DebugDocumentExecutionRequest {
    const effectiveCanvasNodes = canvasNodes.length > 0 ? canvasNodes : buildFallbackCanvasNodes(flowDocument);
    const effectiveCanvasEdges = canvasEdges.length > 0 ? canvasEdges : buildFallbackCanvasEdges(flowDocument);
    const draftDocument = applyCanvasStateToDocument(flowDocument, effectiveCanvasNodes, effectiveCanvasEdges);

    return {
        groupId,
        flowPath,
        documentHash: flowDocument.documentHash,
        documentUpdatedAt: flowDocument.documentUpdatedAt,
        stages: draftDocument.stages.map((stage) => ({
            stageId: stage.stageId,
            nodes: stage.nodes.map((node) => ({
                taskId: node.taskId,
                kind: node.kind,
                scriptPath: node.scriptPath,
                scriptContent: node.scriptContent,
                dataSourceId: node.dataSourceId,
                dataSourceType: node.dataSourceType,
            })),
        })),
        edges: draftDocument.edges,
        layout: draftDocument.layout,
        selectedTaskIds,
        mode: 'SELECTED',
    };
}
