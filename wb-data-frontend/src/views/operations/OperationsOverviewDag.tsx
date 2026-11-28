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
import { Code2, RotateCcw, Terminal } from 'lucide-react';
import type { OfflineFlowNodeKind } from '../../api/offline';
import type { OperationsExecutionGraphNode, OperationsRerunGraphEdge } from '../../api/operations';
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
import { formatBrowserDateTime } from '../../lib/dateTime';
import { getNodeInspectButtonLabel } from './instancePresentation';
import { computeRerunCanvasLayout } from './rerunSelection';
import './OperationsOverviewDag.css';

interface OperationsOverviewDagProps {
    nodes: OperationsExecutionGraphNode[];
    edges: OperationsRerunGraphEdge[];
    blockedUpstreamIds: ReadonlySet<string>;
    isExecutionActive: boolean;
    selectedTaskId: string | null;
    onSelectTask: (taskId: string) => void;
    onInspectNode: (taskId: string) => void;
    onViewLogs: (taskId: string) => void;
}

interface OverviewDagNodeData extends Record<string, unknown> {
    taskId: string;
    kind: OfflineFlowNodeKind;
    status: string;
    durationLabel: string;
    blockedByUpstream: boolean;
    isExecutionActive: boolean;
    selected: boolean;
    onSelect: () => void;
}

const OVERVIEW_FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1.08 };

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

function formatDurationCompact(durationMs: number | null | undefined) {
    if (durationMs == null) return '—';
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const minuteRest = minutes % 60;
    return minuteRest > 0 ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function OverviewDagNode({ data }: NodeProps<Node<OverviewDagNodeData>>) {
    const kindClass = getOfflineNodeKindClassName(data.kind);
    const kindLabel = getOfflineNodeKindLabel(data.kind);
    const statusTone = resolveStatusTone(data.status);
    const StatusIcon = getTaskStatusIcon(data.status);
    const statusText = data.status === 'NOT_RUN'
        ? (data.blockedByUpstream ? '未执行（上游失败）' : data.isExecutionActive ? '等待执行' : '未执行')
        : getExecutionStatusLabel(data.status);
    const isNotRun = data.status === 'NOT_RUN';

    return (
        <div
            role="button"
            tabIndex={0}
            aria-pressed={data.selected}
            aria-label={`${data.taskId}，状态 ${statusText}`}
            className={`operations-overview-dag-card nodrag nopan is-${statusTone}${isNotRun ? ' is-not-run' : ''}${data.selected ? ' is-selected' : ''}`}
            onClick={(event) => {
                event.stopPropagation();
                data.onSelect();
            }}
            onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    data.onSelect();
                }
            }}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="operations-overview-dag-handle"
                isConnectable={false}
            />
            <div className="operations-overview-dag-card__top">
                <span
                    className={`operations-overview-dag-kind is-${kindClass}`}
                    title={kindLabel}
                    aria-label={kindLabel}
                >
                    <NodeKindIcon kind={data.kind} size={13} decorative />
                </span>
                <strong className="operations-overview-dag-card__title" title={data.taskId}>
                    {data.taskId}
                </strong>
            </div>
            <div className="operations-overview-dag-card__bottom">
                <span className={`operations-execution-status operations-execution-status--${statusTone}`}>
                    <StatusIcon size={12} className={isRunningStatus(data.status) ? 'operations-execution-spin' : undefined} />
                    {statusText}
                </span>
                <span className="operations-overview-dag-card__duration">{data.durationLabel}</span>
            </div>
            <Handle
                type="source"
                position={Position.Bottom}
                className="operations-overview-dag-handle"
                isConnectable={false}
            />
        </div>
    );
}

const OVERVIEW_NODE_TYPES = {
    overviewNode: OverviewDagNode,
};

function OverviewDagInner({
    nodes: graphNodes,
    edges: graphEdges,
    blockedUpstreamIds,
    isExecutionActive,
    selectedTaskId,
    fitTrigger,
    onSelectTask,
}: {
    nodes: OperationsExecutionGraphNode[];
    edges: OperationsRerunGraphEdge[];
    blockedUpstreamIds: ReadonlySet<string>;
    isExecutionActive: boolean;
    selectedTaskId: string | null;
    fitTrigger: number;
    onSelectTask: (taskId: string) => void;
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

    const nodeStatusById = useMemo(
        () => new Map(graphNodes.map((node) => [node.taskId, node.status])),
        [graphNodes],
    );

    const rfNodes = useMemo<Node<OverviewDagNodeData>[]>(() => (
        graphNodes.map((node) => ({
            id: node.taskId,
            type: 'overviewNode',
            position: positions[node.taskId] ?? { x: 0, y: 0 },
            draggable: false,
            selectable: false,
            connectable: false,
            style: { pointerEvents: 'all' },
            data: {
                taskId: node.taskId,
                kind: resolveNodeKind(node.kind),
                status: node.status,
                durationLabel: formatDurationCompact(node.durationMs),
                blockedByUpstream: blockedUpstreamIds.has(node.taskId),
                isExecutionActive,
                selected: selectedTaskId === node.taskId,
                onSelect: () => onSelectTask(node.taskId),
            },
        }))
    ), [blockedUpstreamIds, graphNodes, isExecutionActive, onSelectTask, positions, selectedTaskId]);

    const rfEdges = useMemo<Edge[]>(() => (
        graphEdges.map((edge) => {
            const sourceStatus = nodeStatusById.get(edge.source) ?? 'NOT_RUN';
            const targetStatus = nodeStatusById.get(edge.target) ?? 'NOT_RUN';
            const sourceTone = resolveStatusTone(sourceStatus);
            const targetNotRun = targetStatus === 'NOT_RUN';
            const stroke = sourceTone === 'failed'
                ? 'var(--color-error)'
                : targetNotRun
                    ? 'rgba(140, 130, 120, 0.35)'
                    : 'var(--color-brand)';
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
                    strokeWidth: sourceTone === 'failed' || !targetNotRun ? 1.8 : 1.4,
                    strokeDasharray: targetNotRun ? '5 4' : undefined,
                },
            };
        })
    ), [graphEdges, nodeStatusById]);

    const fit = useCallback((duration: number) => {
        void Promise.resolve(reactFlow.fitView?.({ ...OVERVIEW_FIT_VIEW_OPTIONS, duration }));
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
        <div className="operations-overview-dag-flow">
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={OVERVIEW_NODE_TYPES}
                proOptions={{ hideAttribution: true }}
                fitView
                fitViewOptions={OVERVIEW_FIT_VIEW_OPTIONS}
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

export function OperationsOverviewDag({
    nodes,
    edges,
    blockedUpstreamIds,
    isExecutionActive,
    selectedTaskId,
    onSelectTask,
    onInspectNode,
    onViewLogs,
}: OperationsOverviewDagProps) {
    const [fitTrigger, setFitTrigger] = useState(0);

    const activeNode = useMemo(() => {
        if (nodes.length === 0) return null;
        if (selectedTaskId) {
            const match = nodes.find((node) => node.taskId === selectedTaskId);
            if (match) return match;
        }
        return nodes.find((node) => getExecutionPresentation(node.status).dotTone === 'failed')
            ?? nodes.find((node) => node.status !== 'NOT_RUN')
            ?? nodes[0];
    }, [nodes, selectedTaskId]);

    const statusSummary = useMemo(() => {
        let failed = 0;
        let success = 0;
        let notRun = 0;
        for (const node of nodes) {
            if (node.status === 'NOT_RUN') notRun++;
            else if (resolveStatusTone(node.status) === 'failed') failed++;
            else if (resolveStatusTone(node.status) === 'success') success++;
        }
        const parts = [`共 ${nodes.length} 个节点`];
        if (success > 0) parts.push(`${success} 成功`);
        if (failed > 0) parts.push(`${failed} 失败`);
        if (notRun > 0) parts.push(`${notRun} 未执行`);
        return parts.join(' · ');
    }, [nodes]);

    const activeStatusLabel = activeNode
        ? (activeNode.status === 'NOT_RUN'
            ? (blockedUpstreamIds.has(activeNode.taskId) ? '未执行（上游失败）' : isExecutionActive ? '等待执行' : '未执行')
            : getExecutionStatusLabel(activeNode.status))
        : '';

    return (
        <div className="operations-overview-dag-shell">
            <div className="operations-overview-dag-toolbar">
                <span className="operations-overview-dag-summary">{statusSummary}</span>
                <button
                    type="button"
                    className="operations-rerun-tool-btn"
                    onClick={() => setFitTrigger((count) => count + 1)}
                >
                    <RotateCcw size={12} aria-hidden="true" />
                    重置视图
                </button>
            </div>

            <ReactFlowProvider>
                <OverviewDagInner
                    nodes={nodes}
                    edges={edges}
                    blockedUpstreamIds={blockedUpstreamIds}
                    isExecutionActive={isExecutionActive}
                    selectedTaskId={activeNode?.taskId ?? null}
                    fitTrigger={fitTrigger}
                    onSelectTask={onSelectTask}
                />
            </ReactFlowProvider>

            {activeNode ? (
                <div className="operations-overview-dag-inspector" aria-label="选中节点摘要">
                    <div className="operations-overview-dag-inspector__info">
                        <span className="operations-overview-dag-inspector__name" title={activeNode.taskId}>
                            {activeNode.taskId}
                        </span>
                        <span className={`operations-execution-status operations-execution-status--${resolveStatusTone(activeNode.status)}`}>
                            {activeStatusLabel}
                        </span>
                        <span className="operations-overview-dag-inspector__meta">
                            开始 {formatBrowserDateTime(activeNode.startDate)}
                        </span>
                        <span className="operations-overview-dag-inspector__meta">
                            耗时 {formatDurationCompact(activeNode.durationMs)}
                        </span>
                    </div>
                    <div className="operations-overview-dag-inspector__actions">
                        {activeNode.hasCodeSnapshot ? (
                            <button
                                type="button"
                                className="operations-overview-log-btn"
                                onClick={() => onInspectNode(activeNode.taskId)}
                            >
                                <Code2 size={13} aria-hidden="true" />
                                {getNodeInspectButtonLabel(activeNode.kind)}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="operations-overview-log-btn"
                            disabled={activeNode.status === 'NOT_RUN'}
                            title={activeNode.status === 'NOT_RUN' ? '该节点未执行，暂无日志' : undefined}
                            onClick={() => onViewLogs(activeNode.taskId)}
                        >
                            <Terminal size={13} aria-hidden="true" />
                            查看日志
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
