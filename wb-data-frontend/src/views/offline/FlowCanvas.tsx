import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    ControlButton,
    MiniMap,
    useNodesState,
    useEdgesState,
    addEdge,
    reconnectEdge,
    type Node,
    type Edge,
    type Connection,
    type OnConnect,
    type NodeTypes,
    type OnNodesChange,
    type OnEdgesChange,
    BackgroundVariant,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Network, Pencil, Trash2 } from 'lucide-react';
import { FlowCanvasNode, type FlowCanvasNodeData } from './FlowCanvasNode';
import { wouldCreateCycle, autoLayout } from './dagUtils';
import type { OfflineFlowDocument, OfflineFlowNode, OfflineFlowNodeKind } from '../../api/offline';
import { isOfflineFlowNodeKind } from './offlineNodeKinds';

const nodeTypes: NodeTypes = {
    flowNode: FlowCanvasNode,
};

interface FlowCanvasProps {
    flowDocument: OfflineFlowDocument;
    selectedTaskIds: string[];
    activeNodeId: string | null;
    onNodesChange: (nodes: Node[]) => void;
    onEdgesChange: (edges: Edge[]) => void;
    onNodeLayoutCommit: (nodes: Node[]) => void;
    onSelectNode: (taskId: string) => void;
    onToggleTaskSelection: (taskId: string) => void;
    onReplaceTaskSelection: (taskIds: string[]) => void;
    onDoubleClickNode: (taskId: string) => void;
    onAddNode?: (kind: OfflineFlowNodeKind, position: { x: number; y: number }) => void;
    onRenameNode?: (oldId: string, newId: string) => void;
    nodeIssues?: Record<string, string | null>;
}

function flattenNodes(doc: OfflineFlowDocument): OfflineFlowNode[] {
    return doc.stages.flatMap((stage) => stage.nodes);
}

function buildInitialNodes(
    doc: OfflineFlowDocument,
    selectedTaskIds: string[],
    onToggleTaskSelection: (taskId: string) => void,
    nodeIssues?: Record<string, string | null>,
): Node[] {
    const allNodes = flattenNodes(doc);
    const hasLayout = doc.layout && Object.keys(doc.layout).length > 0;

    return allNodes.map((node, index) => {
        const position = hasLayout && doc.layout[node.taskId]
            ? { x: doc.layout[node.taskId].x, y: doc.layout[node.taskId].y }
            : { x: 250, y: index * 120 }; // fallback position

        return {
            id: node.taskId,
            type: 'flowNode',
            position,
            data: {
                taskId: node.taskId,
                kind: node.kind,
                selected: selectedTaskIds.includes(node.taskId),
                onToggleSelection: onToggleTaskSelection,
                validationError: nodeIssues?.[node.taskId] ?? null,
            } satisfies FlowCanvasNodeData,
        };
    });
}

function buildInitialEdges(doc: OfflineFlowDocument): Edge[] {
    return (doc.edges ?? []).map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: 'default', // ReactFlow uses Bézier by default
        animated: false,
        interactionWidth: 36,
        style: { stroke: 'rgba(166, 106, 71, 0.65)', strokeWidth: 2 },
    }));
}

function isEditableEventTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return true;
    }

    return target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
}

export default function FlowCanvas(props: FlowCanvasProps) {
    const {
        flowDocument,
        selectedTaskIds,
        onNodesChange: onNodesChangeExternal,
        onEdgesChange: onEdgesChangeExternal,
        onNodeLayoutCommit,
        onSelectNode,
        onToggleTaskSelection,
        onReplaceTaskSelection,
        onDoubleClickNode,
        onAddNode,
        onRenameNode,
        nodeIssues,
    } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
    const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

    const handleInlineRenameCommit = useCallback((oldId: string, newId: string) => {
        if (onRenameNode) {
            // Re-use the existing rename logic (which should handle stages, edges, etc.)
            // We pass the new name which will trigger the workbench commit
            // In workbench, we'll need a logic to directly commit it.
            // Wait, handleRenameNodeCommit in workbench uses renamingNodeNewName state.
            // I should pass (oldId, newId) to onRenameNode if it supports it.
            onRenameNode(oldId, newId);
        }
        setEditingNodeId(null);
    }, [onRenameNode]);

    const handleInlineRenameCancel = useCallback(() => {
        setEditingNodeId(null);
    }, []);

    // Build initial data
    const initialNodes = useMemo(() => {
        let nodesToLayout = buildInitialNodes(flowDocument, selectedTaskIds, onToggleTaskSelection, nodeIssues);
        const edges = buildInitialEdges(flowDocument);
        const hasLayout = flowDocument.layout && Object.keys(flowDocument.layout).length > 0;
        if (!hasLayout && nodesToLayout.length > 0) {
            nodesToLayout = autoLayout(nodesToLayout, edges, 'TB');
        }

        return nodesToLayout;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flowDocument, onToggleTaskSelection, selectedTaskIds, nodeIssues]);

    const initialEdges = useMemo(
        () => buildInitialEdges(flowDocument),
    // eslint-disable-next-line react-hooks/exhaustive-deps
        [flowDocument],
    );

    const [nodes, setNodes, handleNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, handleEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
        setContextMenu(null); // Clear context menu when switching flows
    }, [initialEdges, initialNodes, setEdges, setNodes]);

    // Clear editing state ONLY when the actual file changes
    useEffect(() => {
        setEditingNodeId(null);
    }, [flowDocument.path]);

    useEffect(() => {
        onNodesChangeExternal(nodes);
    }, [nodes, onNodesChangeExternal]);

    useEffect(() => {
        onEdgesChangeExternal(edges);
    }, [edges, onEdgesChangeExternal]);

    useEffect(() => {
        setSelectedNodeIds((current) => current.filter((nodeId) => nodes.some((node) => node.id === nodeId)));
    }, [nodes]);

    useEffect(() => {
        setSelectedEdgeIds((current) => current.filter((edgeId) => edges.some((edge) => edge.id === edgeId)));
    }, [edges]);

    // Keep node data.selected in sync with selectedTaskIds AND append any new nodes added to flowDocument
    useEffect(() => {
        const docNodes = flattenNodes(flowDocument);

        setNodes((nds) => {
            let changed = false;
            let result = [...nds];

            // 1. Sync selection and basic data logic
            result = result.map((n) => {
                const isSelected = selectedTaskIds.includes(n.id);
                const isEditing = n.id === editingNodeId;
                const validationError = nodeIssues?.[n.id] ?? null;
                if (
                    n.data.selected !== isSelected || 
                    n.data.onToggleSelection !== onToggleTaskSelection || 
                    n.data.isEditing !== isEditing ||
                    n.data.validationError !== validationError
                ) {
                    changed = true;
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            selected: isSelected,
                            onToggleSelection: onToggleTaskSelection,
                            isEditing,
                            validationError,
                            onRename: (newId: string) => handleInlineRenameCommit(n.id, newId),
                            onCancelRename: handleInlineRenameCancel,
                        },
                    };
                }
                return n;
            });

            // 2. Check for definitively new nodes added to `flowDocument` but not yet on canvas (e.g. via drag-and-drop)
            const existingNodeIds = new Set(result.map((n) => n.id));
            const newlyAddedDocNodes = docNodes.filter((n) => !existingNodeIds.has(n.taskId));

            if (newlyAddedDocNodes.length > 0) {
                changed = true;
                const newNodes: Node[] = newlyAddedDocNodes.map((node) => {
                    const position = flowDocument.layout?.[node.taskId] 
                        ? { x: flowDocument.layout[node.taskId].x, y: flowDocument.layout[node.taskId].y }
                        : { x: 250, y: 120 }; // fallback
                    return {
                        id: node.taskId,
                        type: 'flowNode',
                        position,
                        data: {
                            taskId: node.taskId,
                            kind: node.kind,
                            selected: selectedTaskIds.includes(node.taskId),
                            onToggleSelection: onToggleTaskSelection,
                            isEditing: node.taskId === editingNodeId,
                            onRename: (newId: string) => handleInlineRenameCommit(node.taskId, newId),
                            onCancelRename: handleInlineRenameCancel,
                            validationError: nodeIssues?.[node.taskId] ?? null,
                        },
                    };
                });
                result = [...result, ...newNodes];
            }

            return changed ? result : nds;
        });
    }, [flowDocument, onToggleTaskSelection, selectedTaskIds, setNodes, editingNodeId, handleInlineRenameCommit, handleInlineRenameCancel]);

    const wrappedNodesChange: OnNodesChange = useCallback(
        (changes) => {
            handleNodesChange(changes);
        },
        [handleNodesChange],
    );

    const wrappedEdgesChange: OnEdgesChange = useCallback(
        (changes) => {
            handleEdgesChange(changes);
        },
        [handleEdgesChange],
    );

    const onConnect: OnConnect = useCallback(
        (connection: Connection) => {
            setEdges((eds) => {
                const newEdges = addEdge(
                    {
                        ...connection,
                        type: 'default',
                        style: { stroke: 'rgba(166, 106, 71, 0.65)', strokeWidth: 2 },
                    },
                    eds,
                );
                return newEdges;
            });
        },
        [setEdges],
    );

    const onReconnect = useCallback(
        (oldEdge: Edge, newConnection: Connection) => {
            setEdges((eds) => {
                const newEdges = reconnectEdge(oldEdge, newConnection, eds);
                return newEdges;
            });
        },
        [setEdges],
    );

    const isValidConnection = useCallback(
        (connection: Connection | Edge) => {
            if (!connection.source || !connection.target) return false;
            if (connection.source === connection.target) return false;
            return !wouldCreateCycle(nodes, edges, connection.source, connection.target);
        },
        [nodes, edges],
    );

    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            containerRef.current?.focus();
            setSelectedNodeIds([node.id]);
            setSelectedEdgeIds([]);
            setNodes((current) => current.map((item) => ({
                ...item,
                selected: item.id === node.id,
            })));
            setEdges((current) => current.map((item) => ({
                ...item,
                selected: false,
            })));
            onSelectNode(node.id);
        },
        [onReplaceTaskSelection, onSelectNode, setEdges, setNodes],
    );

    const onNodeDoubleClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            onDoubleClickNode(node.id);
        },
        [onDoubleClickNode],
    );

    const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
        containerRef.current?.focus();
        setSelectedNodeIds([]);
        setSelectedEdgeIds([edge.id]);
        setNodes((current) => current.map((item) => ({
            ...item,
            selected: false,
        })));
        setEdges((current) => current.map((item) => ({
            ...item,
            selected: item.id === edge.id,
        })));
    }, [setEdges, setNodes]);

    const onPaneClick = useCallback(() => {
        containerRef.current?.focus();
        setSelectedNodeIds([]);
        setSelectedEdgeIds([]);
        setNodes((current) => current.map((item) => ({
            ...item,
            selected: false,
        })));
        setEdges((current) => current.map((item) => ({
            ...item,
            selected: false,
        })));
    }, [setEdges, setNodes]);

    const onNodeDragStop = useCallback(
        (_: React.MouseEvent, _node: Node, currentNodes: Node[]) => {
            onNodeLayoutCommit(currentNodes);
        },
        [onNodeLayoutCommit],
    );

    const onSelectionChange = useCallback((selection: { nodes: Node[]; edges: Edge[] }) => {
        const nextSelectedNodeIds = selection.nodes.map((node) => node.id);
        const nextSelectedEdgeIds = selection.edges.map((edge) => edge.id);
        const selectedNodeIdSet = new Set(nextSelectedNodeIds);
        const selectedEdgeIdSet = new Set(nextSelectedEdgeIds);

        setSelectedNodeIds(nextSelectedNodeIds);
        setSelectedEdgeIds(nextSelectedEdgeIds);
        setNodes((current) => current.map((item) => ({
            ...item,
            selected: selectedNodeIdSet.has(item.id),
        })));
        setEdges((current) => current.map((item) => ({
            ...item,
            selected: selectedEdgeIdSet.has(item.id),
        })));
        if (nextSelectedNodeIds.length > 0) {
            // No longer syncing canvas selection to task selection checkboxes
        }
    }, [setEdges, setNodes]);

    const onNodesDelete = useCallback(
        (deletedNodes: Node[]) => {
            const deletedIds = new Set(deletedNodes.map((node) => node.id));
            setNodes((current) => current.filter((node) => !deletedIds.has(node.id)));
            setEdges((current) => current.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)));
            setSelectedNodeIds((current) => current.filter((nodeId) => !deletedIds.has(nodeId)));
        },
        [setEdges, setNodes],
    );

    const onEdgesDelete = useCallback(
        (deletedEdges: Edge[]) => {
            const deletedIds = new Set(deletedEdges.map((edge) => edge.id));
            setEdges((current) => current.filter((edge) => !deletedIds.has(edge.id)));
            setSelectedEdgeIds((current) => current.filter((edgeId) => !deletedIds.has(edgeId)));
        },
        [setEdges],
    );

    const handleDeleteSelection = useCallback(() => {
        const domSelectedNodeIds = containerRef.current
            ? Array.from(containerRef.current.querySelectorAll<Element>('.react-flow__node.selected'))
                .map((element) => element.getAttribute('data-id'))
                .filter((value): value is string => Boolean(value))
            : [];
        const domSelectedEdgeIds = containerRef.current
            ? Array.from(containerRef.current.querySelectorAll<Element>('.react-flow__edge.selected'))
                .map((element) => element.getAttribute('data-id'))
                .filter((value): value is string => Boolean(value))
            : [];

        const effectiveSelectedNodeIds = domSelectedNodeIds.length > 0 ? domSelectedNodeIds : selectedNodeIds;
        const effectiveSelectedEdgeIds = domSelectedEdgeIds.length > 0 ? domSelectedEdgeIds : selectedEdgeIds;

        if (effectiveSelectedNodeIds.length > 0) {
            const deletedNodeIds = new Set(effectiveSelectedNodeIds);
            setNodes((current) => current.filter((node) => !deletedNodeIds.has(node.id)));
            setEdges((current) => current.filter((edge) => !deletedNodeIds.has(edge.source) && !deletedNodeIds.has(edge.target)));
            setSelectedNodeIds([]);
            setSelectedEdgeIds([]);
            return;
        }

        if (effectiveSelectedEdgeIds.length > 0) {
            const deletedEdgeIds = new Set(effectiveSelectedEdgeIds);
            setEdges((current) => current.filter((edge) => !deletedEdgeIds.has(edge.id)));
            setSelectedEdgeIds([]);
        }
    }, [selectedEdgeIds, selectedNodeIds, setEdges, setNodes]);

    const onContainerKeyDown = useCallback((event: KeyboardEvent) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') {
            return;
        }

        if (isEditableEventTarget(event.target)) {
            return;
        }

        event.preventDefault();
        handleDeleteSelection();
    }, [handleDeleteSelection]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        container.addEventListener('keydown', onContainerKeyDown);
        return () => {
            container.removeEventListener('keydown', onContainerKeyDown);
        };
    }, [onContainerKeyDown]);

    const defaultEdgeOptions = useMemo(
        () => ({
            type: 'default' as const,
            interactionWidth: 36,
            style: { stroke: 'rgba(166, 106, 71, 0.65)', strokeWidth: 2 },
        }),
        [],
    );

    const handleAutoLayout = useCallback(() => {
        const nextNodes = autoLayout(nodes, edges, 'TB');
        setNodes(nextNodes);
        onNodeLayoutCommit(nextNodes);
    }, [edges, nodes, onNodeLayoutCommit, setNodes]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            const kind = event.dataTransfer.getData('nodeKind');
            if (!isOfflineFlowNodeKind(kind)) {
                return;
            }
            if (!onAddNode) return;

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });
            onAddNode(kind, position);
        },
        [onAddNode, screenToFlowPosition]
    );

    const onNodeContextMenu = useCallback(
        (event: React.MouseEvent, node: Node) => {
            event.preventDefault();
            
            // Calculate position relative to container
            if (!containerRef.current) return;
            const containerRect = containerRef.current.getBoundingClientRect();
            
            setContextMenu({
                x: event.clientX - containerRect.left,
                y: event.clientY - containerRect.top,
                nodeId: node.id,
            });
        },
        []
    );

    const handleNodeRename = useCallback(() => {
        if (contextMenu) {
            setEditingNodeId(contextMenu.nodeId);
        }
        setContextMenu(null);
    }, [contextMenu]);

    const handleNodeDelete = useCallback(() => {
        if (contextMenu) {
            const nodeToDelete = nodes.find(n => n.id === contextMenu.nodeId);
            if (nodeToDelete) {
                onNodesDelete([nodeToDelete]);
            }
        }
        setContextMenu(null);
    }, [contextMenu, nodes, onNodesDelete]);

    const handleNodeCopyName = useCallback(() => {
        if (!contextMenu) {
            return;
        }

        void navigator.clipboard.writeText(contextMenu.nodeId);
        setContextMenu(null);
    }, [contextMenu]);

    return (
        <div
            ref={containerRef}
            className="flow-canvas-container"
            tabIndex={0}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={wrappedNodesChange}
                onEdgesChange={wrappedEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onNodeDragStop={onNodeDragStop}
                onSelectionChange={onSelectionChange}
                onNodesDelete={onNodesDelete}
                onEdgesDelete={onEdgesDelete}
                onNodeContextMenu={onNodeContextMenu}
                onPaneClick={() => {
                    onPaneClick();
                    setContextMenu(null);
                    setEditingNodeId(null);
                }}
                isValidConnection={isValidConnection}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onEdgeClick={onEdgeClick}
                nodeTypes={nodeTypes}
                defaultEdgeOptions={defaultEdgeOptions}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.2}
                maxZoom={2}
                snapToGrid
                snapGrid={[20, 20]}
                deleteKeyCode={null}
                elementsSelectable
                nodesFocusable
                edgesFocusable
                edgesReconnectable
                selectionOnDrag
                panOnScroll
                proOptions={{ hideAttribution: true }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1.5}
                    color="rgba(120, 100, 80, 0.25)"
                />
                <Controls
                    showInteractive={false}
                    className="flow-canvas-controls"
                >
                    <ControlButton onClick={handleAutoLayout} title="自动排版 (一键整理)" aria-label="自动排版">
                        <Network size={16} />
                    </ControlButton>
                </Controls>
                <MiniMap
                    nodeStrokeColor="rgba(166, 106, 71, 0.5)"
                    nodeColor="rgba(255, 253, 248, 0.94)"
                    nodeBorderRadius={8}
                    maskColor="rgba(246, 242, 235, 0.7)"
                    className="flow-canvas-minimap"
                />
            </ReactFlow>

            {/* Node Context Menu */}
            {contextMenu && (
                <div
                    className="offline-context-menu"
                    style={{
                        position: 'absolute',
                        left: contextMenu.x,
                        top: contextMenu.y,
                        zIndex: 10000,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        className="offline-context-menu-item"
                        onClick={handleNodeRename}
                    >
                        <Pencil size={13} />
                        重命名
                    </button>
                    <button
                        type="button"
                        className="offline-context-menu-item"
                        onClick={handleNodeCopyName}
                    >
                        <Copy size={13} />
                        复制节点名称
                    </button>
                    <button
                        type="button"
                        className="offline-context-menu-item danger"
                        onClick={handleNodeDelete}
                    >
                        <Trash2 size={13} />
                        删除
                    </button>
                </div>
            )}
        </div>
    );
}
