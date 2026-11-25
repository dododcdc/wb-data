import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    BackgroundVariant,
    Controls,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useNodesInitialized,
    useReactFlow,
    type Edge,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { Check, CheckSquare, Info, Lock, RotateCcw, Undo2 } from 'lucide-react';
import type { OfflineFlowNodeKind } from '../../api/offline';
import type { OperationsRerunGraphEdge, OperationsRerunGraphNode } from '../../api/operations';
import {
    getExecutionPresentation,
    getExecutionStatusLabel,
    getTaskStatusIcon,
    isRunningStatus,
} from '../../components/execution/executionPresentation';
import { NodeKindIcon } from '../../components/execution/NodeKindIcon';
import {
    getOfflineNodeKindClassName,
    getOfflineNodeKindLabel,
    isOfflineFlowNodeKind,
} from '../../components/execution/offlineNodeKinds';
import { computeRerunCanvasLayout } from './rerunSelection';
import './OperationsRerunCanvas.css';

interface OperationsRerunCanvasProps {
    nodes: OperationsRerunGraphNode[];
    edges: OperationsRerunGraphEdge[];
    selectedTaskIds: ReadonlySet<string>;
    requiredTaskIds: ReadonlySet<string>;
    partialRerunSupported: boolean;
    disabled?: boolean;
    feedbackMessage?: string | null;
    onToggleNode: (taskId: string) => void;
    onSelectAll: () => void;
    onResetDefault: () => void;
}

interface RerunCanvasNodeData extends Record<string, unknown> {
    taskId: string;
    kind: OfflineFlowNodeKind;
    executionStatus: string;
    selected: boolean;
    locked: boolean;
    disabled: boolean;
    onToggle: () => void;
}

const RERUN_FIT_VIEW_OPTIONS = { padding: 0.18, maxZoom: 1.05 };

function resolveNodeKind(kind: string): OfflineFlowNodeKind {
    return isOfflineFlowNodeKind(kind) ? kind : 'SHELL';
}

function resolveStatusTone(status: string): 'success' | 'failed' | 'running' | 'neutral' {
    const tone = getExecutionPresentation(status).dotTone;
    if (tone === 'success') return 'success';
    if (tone === 'failed') return 'failed';
    if (tone === 'running') return 'running';
    return 'neutral';
}

function RerunCanvasNode({ data }: NodeProps<Node<RerunCanvasNodeData>>) {
    const kindClass = getOfflineNodeKindClassName(data.kind);
    const kindLabel = getOfflineNodeKindLabel(data.kind);
    const statusLabel = getExecutionStatusLabel(data.executionStatus);
    const statusTone = resolveStatusTone(data.executionStatus);
    const StatusIcon = getTaskStatusIcon(data.executionStatus);
    const roleLabel = data.locked ? '必选' : data.selected ? '本次重跑' : '跳过';
    const roleClass = data.locked ? 'is-required' : data.selected ? 'is-selected' : 'is-skipped';
    const cardStateClass = data.locked
        ? 'is-selected is-required'
        : data.selected
            ? 'is-selected'
            : 'is-skipped';

    const handleActivate = () => {
        if (data.disabled) return;
        data.onToggle();
    };

    return (
        <div
            role="checkbox"
            aria-checked={data.selected}
            aria-disabled={data.locked || data.disabled}
            aria-label={`${data.taskId}，原状态 ${statusLabel}，${roleLabel}`}
            tabIndex={data.disabled ? -1 : 0}
            className={`operations-rerun-card nodrag nopan ${cardStateClass}${data.disabled ? ' is-disabled' : ''}`}
            onClick={(event) => {
                event.stopPropagation();
                handleActivate();
            }}
            onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    handleActivate();
                }
            }}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="operations-rerun-handle"
                isConnectable={false}
            />
            <div className="operations-rerun-card__top">
                <span className="operations-rerun-card__check" aria-hidden="true">
                    {data.locked ? <Lock size={11} /> : data.selected ? <Check size={12} /> : null}
                </span>
                <strong className="operations-rerun-card__title" title={data.taskId}>
                    {data.taskId}
                </strong>
                <span
                    className={`operations-rerun-node-kind is-${kindClass}`}
                    aria-label={kindLabel}
                    title={kindLabel}
                >
                    <NodeKindIcon kind={data.kind} size={13} decorative />
                </span>
            </div>
            <div className="operations-rerun-card__bottom">
                <span className={`operations-rerun-node-status is-${statusTone}`}>
                    <StatusIcon size={12} className={isRunningStatus(data.executionStatus) ? 'operations-spin' : undefined} />
                    {statusLabel}
                </span>
                <span className={`operations-rerun-node-role ${roleClass}`}>
                    {roleLabel}
                </span>
            </div>
            <Handle
                type="source"
                position={Position.Bottom}
                className="operations-rerun-handle"
                isConnectable={false}
            />
        </div>
    );
}

const RERUN_NODE_TYPES = {
    rerunNode: RerunCanvasNode,
};

function RerunCanvasInner({
    nodes: graphNodes,
    edges: graphEdges,
    selectedTaskIds,
    requiredTaskIds,
    disabled,
    fitTrigger,
    onToggleNode,
}: {
    nodes: OperationsRerunGraphNode[];
    edges: OperationsRerunGraphEdge[];
    selectedTaskIds: ReadonlySet<string>;
    requiredTaskIds: ReadonlySet<string>;
    disabled: boolean;
    fitTrigger: number;
    onToggleNode: (taskId: string) => void;
}) {
    const reactFlow = useReactFlow();
    const nodesInitialized = useNodesInitialized();
    const hasInitialFitRef = useRef(false);
    const prevLayoutKeyRef = useRef<string | null>(null);

    const layoutKey = useMemo(
        () => `${graphNodes.map((n) => n.taskId).join(',')}::${graphEdges.map((e) => `${e.source}->${e.target}`).join(',')}`,
        [graphEdges, graphNodes],
    );

    const positions = useMemo(
        () => computeRerunCanvasLayout(graphNodes, graphEdges),
        [graphEdges, graphNodes],
    );

    const rfNodes = useMemo<Node<RerunCanvasNodeData>[]>(() => (
        graphNodes.map((node) => ({
            id: node.taskId,
            type: 'rerunNode',
            position: positions[node.taskId] ?? { x: 0, y: 0 },
            draggable: false,
            selectable: false,
            connectable: false,
            style: { pointerEvents: 'all' },
            data: {
                taskId: node.taskId,
                kind: resolveNodeKind(node.kind),
                executionStatus: node.executionStatus,
                selected: selectedTaskIds.has(node.taskId),
                locked: requiredTaskIds.has(node.taskId),
                disabled,
                onToggle: () => onToggleNode(node.taskId),
            },
        }))
    ), [disabled, graphNodes, onToggleNode, positions, requiredTaskIds, selectedTaskIds]);

    const rfEdges = useMemo<Edge[]>(() => (
        graphEdges.map((edge) => {
            const sourceSelected = selectedTaskIds.has(edge.source);
            const targetSelected = selectedTaskIds.has(edge.target);
            const bothSelected = sourceSelected && targetSelected;
            const stroke = bothSelected
                ? 'var(--color-brand)'
                : targetSelected
                    ? 'rgba(166, 106, 71, 0.36)'
                    : 'rgba(140, 130, 120, 0.25)';
            return {
                id: `${edge.source}->${edge.target}`,
                source: edge.source,
                target: edge.target,
                type: 'default',
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 13,
                    height: 13,
                    color: stroke,
                },
                style: {
                    stroke,
                    strokeWidth: bothSelected ? 2 : 1.4,
                    strokeDasharray: !sourceSelected ? '4 3' : undefined,
                },
            };
        })
    ), [graphEdges, selectedTaskIds]);

    const fit = useCallback((duration: number) => {
        void Promise.resolve(reactFlow.fitView?.({ ...RERUN_FIT_VIEW_OPTIONS, duration }));
    }, [reactFlow]);

    useEffect(() => {
        if (!nodesInitialized) return;
        const layoutChanged = prevLayoutKeyRef.current !== layoutKey;
        if (!hasInitialFitRef.current || layoutChanged) {
            let raf2 = 0;
            const raf1 = window.requestAnimationFrame(() => {
                raf2 = window.requestAnimationFrame(() => {
                    hasInitialFitRef.current = true;
                    prevLayoutKeyRef.current = layoutKey;
                    fit(0);
                });
            });
            return () => {
                window.cancelAnimationFrame(raf1);
                if (raf2) window.cancelAnimationFrame(raf2);
            };
        }
    }, [fit, layoutKey, nodesInitialized]);

    useEffect(() => {
        if (fitTrigger === 0) return;
        fit(200);
    }, [fit, fitTrigger]);

    return (
        <div className="operations-rerun-reactflow-wrap">
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={RERUN_NODE_TYPES}
                proOptions={{ hideAttribution: true }}
                fitView
                fitViewOptions={RERUN_FIT_VIEW_OPTIONS}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1.4}
                    color="rgba(120, 100, 80, 0.2)"
                />
                <Controls showInteractive={false} />
            </ReactFlow>
        </div>
    );
}

export function OperationsRerunCanvas({
    nodes,
    edges,
    selectedTaskIds,
    requiredTaskIds,
    partialRerunSupported,
    disabled = false,
    feedbackMessage,
    onToggleNode,
    onSelectAll,
    onResetDefault,
}: OperationsRerunCanvasProps) {
    const [fitTrigger, setFitTrigger] = useState(0);
    const totalCount = nodes.length;
    const selectedCount = selectedTaskIds.size;
    const isPartial = partialRerunSupported && selectedCount > 0 && selectedCount < totalCount;
    const canSelectPartial = partialRerunSupported && totalCount > 1;

    return (
        <div className="operations-rerun-canvas-shell">
            <div className="operations-rerun-canvas-toolbar">
                <div className="operations-rerun-canvas-summary">
                    <span className="operations-rerun-canvas-count">
                        已选 {selectedCount} / {totalCount} 个节点
                    </span>
                    <span className={`operations-rerun-mode-pill ${isPartial ? 'is-partial' : 'is-full'}`}>
                        {isPartial ? '部分重跑' : '全量重跑'}
                    </span>
                    <span className="operations-rerun-canvas-legend" aria-hidden="true">
                        <span className="operations-rerun-legend-item">
                            <span className="operations-rerun-legend-swatch is-required" />
                            必选
                        </span>
                        <span className="operations-rerun-legend-item">
                            <span className="operations-rerun-legend-swatch is-selected" />
                            本次重跑
                        </span>
                        <span className="operations-rerun-legend-item">
                            <span className="operations-rerun-legend-swatch is-skipped" />
                            跳过
                        </span>
                    </span>
                </div>
                <div className="operations-rerun-canvas-actions">
                    {canSelectPartial ? (
                        <>
                            <button
                                type="button"
                                className="operations-rerun-tool-btn"
                                disabled={disabled}
                                onClick={onResetDefault}
                            >
                                <Undo2 size={12} aria-hidden="true" />
                                恢复默认选区
                            </button>
                            <button
                                type="button"
                                className="operations-rerun-tool-btn"
                                disabled={disabled || selectedCount === totalCount}
                                onClick={onSelectAll}
                            >
                                <CheckSquare size={12} aria-hidden="true" />
                                全选重跑
                            </button>
                        </>
                    ) : null}
                    <button
                        type="button"
                        className="operations-rerun-tool-btn"
                        disabled={disabled}
                        onClick={() => setFitTrigger((count) => count + 1)}
                    >
                        <RotateCcw size={12} aria-hidden="true" />
                        重置视图
                    </button>
                </div>
            </div>

            {feedbackMessage ? (
                <div className="operations-rerun-feedback" role="status">
                    <Info size={14} className="shrink-0" aria-hidden="true" />
                    <span>{feedbackMessage}</span>
                </div>
            ) : null}

            <ReactFlowProvider>
                <RerunCanvasInner
                    nodes={nodes}
                    edges={edges}
                    selectedTaskIds={selectedTaskIds}
                    requiredTaskIds={requiredTaskIds}
                    disabled={disabled}
                    fitTrigger={fitTrigger}
                    onToggleNode={onToggleNode}
                />
            </ReactFlowProvider>
        </div>
    );
}
