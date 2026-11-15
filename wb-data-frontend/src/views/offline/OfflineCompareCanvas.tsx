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
    type Viewport,
} from '@xyflow/react';
import { AlertCircle, Crosshair, RotateCcw } from 'lucide-react';
import type {
    NodePosition,
    OfflineFlowNode,
    OfflineFlowNodeKind,
    OfflineFlowVersionSnapshot,
} from '../../api/offline';
import {
    buildUnifiedCompareLayout,
    COMPARE_NODE_HEIGHT,
    COMPARE_NODE_WIDTH,
} from './compareCanvasLayout';
import {
    diffFlowVersions,
    getNodeChangeReasons,
    hasNodeChanges,
    type FlowVersionDiff,
    type NodeVersionDiff,
} from './flowVersionDiff';
import type { VersionSelection } from './OfflineVersionCompareDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { NodeKindIcon } from './nodeKindIcons';
import { getOfflineNodeKindClassName, getOfflineNodeKindLabel } from './offlineNodeKinds';
import {
    formatDataSourceDisplay,
    formatRevisionTag,
    formatVersionTooltipSummary,
} from './versionComparePresentation';
import { VersionHoverTooltip } from './VersionHoverTooltip';
import './OfflineCompareCanvas.css';

interface OfflineCompareCanvasProps {
    base?: VersionSelection;
    target?: VersionSelection;
    baseSnapshot: OfflineFlowVersionSnapshot;
    targetSnapshot: OfflineFlowVersionSnapshot;
    diff?: FlowVersionDiff;
    dataSourceNames?: Record<number, string>;
    focusNodeRequest?: { taskId: string; seq: number } | null;
    onSelectNode?: (nodeDiff: NodeVersionDiff) => void;
}

type NodeDiffVisualStatus = 'unchanged' | 'modified' | 'added' | 'removed';

interface CompareNodeData extends Record<string, unknown> {
    taskId: string;
    kind: OfflineFlowNodeKind;
    diffStatus: NodeDiffVisualStatus;
    reasons: string[];
    sourceSummary: string;
    isFocused: boolean;
    onInspect: () => void;
}

const TRAPEZOID_TAB_PATH =
    'M 0.5 18.25 C 6.5 18.25 10.5 0.75 19.5 0.75 L 52.5 0.75 C 61.5 0.75 65.5 18.25 71.5 18.25 Z';

function CompareCanvasNode({ data }: NodeProps<Node<CompareNodeData>>) {
    const kindClass = getOfflineNodeKindClassName(data.kind);
    const kindLabel = getOfflineNodeKindLabel(data.kind);
    const statusText =
        data.diffStatus === 'added'
            ? '新增'
            : data.diffStatus === 'removed'
                ? '删除'
                : data.diffStatus === 'modified'
                    ? '变更'
                    : null;

    const metaSegments = [
        kindLabel,
        data.sourceSummary || null,
        data.reasons.length > 0 ? `变更：${data.reasons.join('、')}` : null,
    ].filter(Boolean);
    const tooltipText = `${data.taskId}（${metaSegments.join(' · ')}）· 双击查看节点详情`;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div
                    className={`compare-canvas-card is-${data.diffStatus} ${data.isFocused ? 'is-focused' : ''}`}
                >
                    <Handle
                        type="target"
                        position={Position.Top}
                        className="compare-canvas-handle"
                        isConnectable={false}
                    />

                    <strong className="compare-canvas-title">{data.taskId}</strong>

                    {statusText ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className={`compare-canvas-status-tag is-${data.diffStatus}`}
                                    aria-label={`查看 ${data.taskId} 差异`}
                                    onPointerMove={(event) => event.stopPropagation()}
                                    onFocus={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        data.onInspect();
                                    }}
                                >
                                    <svg
                                        className="compare-canvas-status-tag-shape"
                                        viewBox="0 0 72 19"
                                        preserveAspectRatio="none"
                                        aria-hidden="true"
                                    >
                                        <path d={TRAPEZOID_TAB_PATH} fill="var(--color-bg-primary)" />
                                        <path
                                            d={TRAPEZOID_TAB_PATH}
                                            fill="var(--compare-tab-fill)"
                                            stroke="var(--compare-tab-stroke)"
                                            strokeWidth="1.5"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    <span className="compare-canvas-status-tag-label">{statusText}</span>
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content z-[2400]" side="top">
                                点击查看差异详情
                            </TooltipContent>
                        </Tooltip>
                    ) : null}

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span
                                className={`flow-canvas-node-kind is-icon is-${kindClass}`}
                                aria-label={kindLabel}
                                onPointerMove={(event) => event.stopPropagation()}
                                onFocus={(event) => event.stopPropagation()}
                            >
                                <NodeKindIcon kind={data.kind} size={14} decorative />
                            </span>
                        </TooltipTrigger>
                        <TooltipContent className="tooltip-content z-[2400]" side="top">
                            {kindLabel}
                        </TooltipContent>
                    </Tooltip>

                    <Handle
                        type="source"
                        position={Position.Bottom}
                        className="compare-canvas-handle"
                        isConnectable={false}
                    />
                </div>
            </TooltipTrigger>
            <TooltipContent className="tooltip-content tooltip-content-wrap z-[2400]" side="top" collisionPadding={12}>
                {tooltipText}
            </TooltipContent>
        </Tooltip>
    );
}

const COMPARE_NODE_TYPES = {
    compareNode: CompareCanvasNode,
};

const COMPARE_FIT_VIEW_OPTIONS = { padding: 0.14, maxZoom: 1.05 };

interface SyncDelta {
    gestureId: number;
    leader: 'base' | 'target';
    dx: number;
    dy: number;
    zoomScale: number;
    seq: number;
}

export function OfflineCompareCanvas({
    base,
    target,
    baseSnapshot,
    targetSnapshot,
    diff: providedDiff,
    dataSourceNames,
    focusNodeRequest,
    onSelectNode,
}: OfflineCompareCanvasProps) {
    const resolvedBase: VersionSelection = base ?? {
        revision: baseSnapshot.revision,
        label: formatRevisionTag(baseSnapshot.revision),
    };
    const resolvedTarget: VersionSelection = target ?? {
        revision: targetSnapshot.revision,
        label: formatRevisionTag(targetSnapshot.revision),
    };
    const pairLayoutKey = `${resolvedBase.revision}:${resolvedTarget.revision}:${baseSnapshot.document.documentHash}:${targetSnapshot.document.documentHash}`;
    const [syncedLayoutKey, setSyncedLayoutKey] = useState(pairLayoutKey);
    const [syncViewport, setSyncViewport] = useState(true);
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
    const [focusTrigger, setFocusTrigger] = useState<{ taskId: string; seq: number } | null>(null);
    const [fitTrigger, setFitTrigger] = useState(0);
    const [syncDelta, setSyncDelta] = useState<SyncDelta | null>(null);

    if (syncedLayoutKey !== pairLayoutKey) {
        setSyncedLayoutKey(pairLayoutKey);
        setActiveNodeId(null);
        setFocusTrigger(null);
        setSyncDelta(null);
    }

    const unifiedLayout = useMemo(
        () => buildUnifiedCompareLayout(baseSnapshot.document, targetSnapshot.document),
        [baseSnapshot.document, targetSnapshot.document],
    );
    const activeLeaderRef = useRef<{ pane: 'base' | 'target'; gestureId: number } | null>(null);
    const lastFocusSeqRef = useRef(0);
    const syncGestureSeqRef = useRef(0);
    const syncSeqRef = useRef(0);

    const diff = useMemo(
        () => providedDiff ?? diffFlowVersions(baseSnapshot, targetSnapshot),
        [baseSnapshot, providedDiff, targetSnapshot],
    );

    const diffById = useMemo(
        () => new Map(diff.nodes.map((entry) => [entry.taskId, entry])),
        [diff.nodes],
    );

    const addedEdgeKeys = useMemo(
        () => new Set(diff.edges.filter((entry) => entry.kind === 'ADDED').map((entry) => entry.key)),
        [diff.edges],
    );
    const removedEdgeKeys = useMemo(
        () => new Set(diff.edges.filter((entry) => entry.kind === 'REMOVED').map((entry) => entry.key)),
        [diff.edges],
    );

    const triggerFocus = useCallback((taskId: string) => {
        lastFocusSeqRef.current += 1;
        setActiveNodeId(taskId);
        setFocusTrigger({ taskId, seq: lastFocusSeqRef.current });
    }, []);

    useEffect(() => {
        if (focusNodeRequest) {
            setActiveNodeId(focusNodeRequest.taskId);
            setFocusTrigger({ taskId: focusNodeRequest.taskId, seq: focusNodeRequest.seq });
        }
    }, [focusNodeRequest]);

    const handleToggleSyncViewport = (checked: boolean) => {
        setSyncViewport(checked);
        setSyncDelta(null);
        activeLeaderRef.current = null;
    };

    const handlePaneGestureStart = useCallback((pane: 'base' | 'target') => {
        if (!syncViewport) return null;
        if (activeLeaderRef.current && activeLeaderRef.current.pane !== pane) {
            return null;
        }
        if (activeLeaderRef.current?.pane === pane) {
            return activeLeaderRef.current.gestureId;
        }
        syncGestureSeqRef.current += 1;
        const gestureId = syncGestureSeqRef.current;
        activeLeaderRef.current = { pane, gestureId };
        return gestureId;
    }, [syncViewport]);

    const handlePaneGestureEnd = useCallback((pane: 'base' | 'target') => {
        if (activeLeaderRef.current?.pane === pane) {
            activeLeaderRef.current = null;
        }
    }, []);

    const handlePanePanDelta = useCallback(
        (pane: 'base' | 'target', gestureId: number, delta: { dx: number; dy: number; zoomScale: number }) => {
            if (!syncViewport) return;
            if (activeLeaderRef.current && activeLeaderRef.current.pane !== pane) {
                return;
            }
            syncSeqRef.current += 1;
            setSyncDelta({
                gestureId,
                leader: pane,
                dx: delta.dx,
                dy: delta.dy,
                zoomScale: delta.zoomScale,
                seq: syncSeqRef.current,
            });
        },
        [syncViewport],
    );

    const handleResetView = () => {
        setSyncDelta(null);
        activeLeaderRef.current = null;
        setFocusTrigger(null);
        setFitTrigger((n) => n + 1);
    };

    const inspectNode = useCallback((taskId: string) => {
        const entry = diffById.get(taskId);
        if (entry) {
            setActiveNodeId(taskId);
            onSelectNode?.(entry);
        }
    }, [diffById, onSelectNode]);

    return (
        <TooltipProvider delayDuration={150}>
            <div className="offline-compare-canvas-shell">
                <div className="offline-compare-canvas-toolbar">
                    <div className="offline-compare-toolbar-actions">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="offline-compare-reset-btn"
                                    onClick={handleResetView}
                                >
                                    <RotateCcw size={12} aria-hidden="true" />
                                    重置视图
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content tooltip-content-wrap z-[2400]" side="bottom">
                                恢复默认对齐布局并居中显示全部节点
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <label className="offline-compare-sync-toggle">
                                    <input
                                        type="checkbox"
                                        checked={syncViewport}
                                        onChange={(event) => handleToggleSyncViewport(event.target.checked)}
                                    />
                                    <span>画布联动</span>
                                </label>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content tooltip-content-wrap z-[2400]" side="bottom">
                                拖动或缩放一侧画布时，另一侧保持同步
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                <div className="offline-compare-canvas-grid">
                    <ReactFlowProvider>
                        <CompareCanvasPane
                            pane="base"
                            roleTitle="基准版本"
                            version={resolvedBase}
                            snapshot={baseSnapshot}
                            alignedLayout={unifiedLayout}
                            layoutKey={pairLayoutKey}
                            diffById={diffById}
                            dataSourceNames={dataSourceNames}
                            edgeHighlights={removedEdgeKeys}
                            edgeColor="var(--color-error)"
                            activeNodeId={activeNodeId}
                            focusTrigger={focusTrigger}
                            fitTrigger={fitTrigger}
                            syncViewport={syncViewport}
                            syncDelta={syncDelta}
                            onGestureStart={() => handlePaneGestureStart('base')}
                            onGestureEnd={() => handlePaneGestureEnd('base')}
                            onPanDelta={(gestureId, delta) => handlePanePanDelta('base', gestureId, delta)}
                            onFocusNode={triggerFocus}
                            onInspectNode={inspectNode}
                        />
                    </ReactFlowProvider>

                    <ReactFlowProvider>
                        <CompareCanvasPane
                            pane="target"
                            roleTitle="对比版本"
                            version={resolvedTarget}
                            snapshot={targetSnapshot}
                            alignedLayout={unifiedLayout}
                            layoutKey={pairLayoutKey}
                            diffById={diffById}
                            dataSourceNames={dataSourceNames}
                            edgeHighlights={addedEdgeKeys}
                            edgeColor="var(--color-success)"
                            activeNodeId={activeNodeId}
                            focusTrigger={focusTrigger}
                            fitTrigger={fitTrigger}
                            syncViewport={syncViewport}
                            syncDelta={syncDelta}
                            onGestureStart={() => handlePaneGestureStart('target')}
                            onGestureEnd={() => handlePaneGestureEnd('target')}
                            onPanDelta={(gestureId, delta) => handlePanePanDelta('target', gestureId, delta)}
                            onFocusNode={triggerFocus}
                            onInspectNode={inspectNode}
                        />
                    </ReactFlowProvider>
                </div>
            </div>
        </TooltipProvider>
    );
}

interface CompareCanvasPaneProps {
    pane: 'base' | 'target';
    roleTitle: string;
    version: VersionSelection;
    snapshot: OfflineFlowVersionSnapshot;
    alignedLayout: Record<string, NodePosition>;
    layoutKey: string;
    diffById: Map<string, NodeVersionDiff>;
    dataSourceNames?: Record<number, string>;
    edgeHighlights: Set<string>;
    edgeColor: string;
    activeNodeId: string | null;
    focusTrigger: { taskId: string; seq: number } | null;
    fitTrigger: number;
    syncViewport: boolean;
    syncDelta: SyncDelta | null;
    onGestureStart: () => number | null;
    onGestureEnd: () => void;
    onPanDelta: (gestureId: number, delta: { dx: number; dy: number; zoomScale: number }) => void;
    onFocusNode: (taskId: string) => void;
    onInspectNode: (taskId: string) => void;
}

function CompareCanvasPane({
    pane,
    roleTitle,
    version,
    snapshot,
    alignedLayout,
    layoutKey,
    diffById,
    dataSourceNames,
    edgeHighlights,
    edgeColor,
    activeNodeId,
    focusTrigger,
    fitTrigger,
    syncViewport,
    syncDelta,
    onGestureStart,
    onGestureEnd,
    onPanDelta,
    onFocusNode,
    onInspectNode,
}: CompareCanvasPaneProps) {
    const reactFlow = useReactFlow();
    const nodesInitialized = useNodesInitialized();
    const isProgrammaticRef = useRef(false);
    const programmaticTimerRef = useRef<number | null>(null);
    const lastViewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
    const gestureStartRef = useRef<{ gestureId: number; viewport: Viewport } | null>(null);
    const followerAnchorRef = useRef<{ gestureId: number; viewport: Viewport } | null>(null);
    const hasInitialFitRef = useRef(false);
    const prevLayoutKeyRef = useRef<string | null>(null);

    const positions = alignedLayout;

    const snapshotNodesById = useMemo(() => {
        const map = new Map<string, OfflineFlowNode>();
        for (const stage of snapshot.document.stages ?? []) {
            for (const node of stage.nodes ?? []) {
                map.set(node.taskId, node);
            }
        }
        return map;
    }, [snapshot.document.stages]);

    const nodes = useMemo<Node<CompareNodeData>[]>(() => {
        return [...snapshotNodesById.values()].map((node) => {
            const nodeDiff = diffById.get(node.taskId);
            const changed = nodeDiff ? hasNodeChanges(nodeDiff) : false;
            const diffStatus: NodeDiffVisualStatus = !nodeDiff || !changed
                ? 'unchanged'
                : nodeDiff.kind === 'ADDED'
                    ? 'added'
                    : nodeDiff.kind === 'REMOVED'
                        ? 'removed'
                        : 'modified';
            const reasons = nodeDiff && changed ? getNodeChangeReasons(nodeDiff) : [];
            const kind = node.kind as OfflineFlowNodeKind;
            const sourceSummary = buildSourceSummary(node, dataSourceNames);

            return {
                id: node.taskId,
                type: 'compareNode',
                position: positions[node.taskId] ?? { x: 0, y: 0 },
                className: `offline-compare-node is-${diffStatus} ${activeNodeId === node.taskId ? 'is-focused' : ''}`,
                draggable: false,
                selectable: false,
                connectable: false,
                data: {
                    taskId: node.taskId,
                    kind,
                    diffStatus,
                    reasons,
                    sourceSummary,
                    isFocused: activeNodeId === node.taskId,
                    onInspect: () => onInspectNode(node.taskId),
                },
            };
        });
    }, [activeNodeId, dataSourceNames, diffById, onInspectNode, positions, snapshotNodesById]);

    const edges = useMemo<Edge[]>(() => {
        return (snapshot.document.edges ?? []).map((edge) => {
            const key = `${edge.source}->${edge.target}`;
            const highlighted = edgeHighlights.has(key);
            const strokeColor = highlighted ? edgeColor : 'rgba(166, 106, 71, 0.55)';
            return {
                id: key,
                source: edge.source,
                target: edge.target,
                type: 'default',
                animated: highlighted,
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 14,
                    height: 14,
                    color: strokeColor,
                },
                style: {
                    stroke: strokeColor,
                    strokeWidth: highlighted ? 2.2 : 1.75,
                },
            };
        });
    }, [edgeColor, edgeHighlights, snapshot.document.edges]);

    useEffect(() => () => {
        if (programmaticTimerRef.current !== null) {
            window.clearTimeout(programmaticTimerRef.current);
        }
    }, []);

    const runProgrammaticFit = useCallback((duration: number) => {
        if (programmaticTimerRef.current !== null) {
            window.clearTimeout(programmaticTimerRef.current);
        }
        isProgrammaticRef.current = true;
        gestureStartRef.current = null;
        followerAnchorRef.current = null;
        void Promise.resolve(reactFlow.fitView?.({ ...COMPARE_FIT_VIEW_OPTIONS, duration })).finally(() => {
            programmaticTimerRef.current = window.setTimeout(() => {
                const vp = reactFlow.getViewport?.();
                if (vp) {
                    lastViewportRef.current = vp;
                }
                isProgrammaticRef.current = false;
                programmaticTimerRef.current = null;
            }, 50);
        });
    }, [reactFlow]);

    // Wait two animation frames so ReactFlow commits updated aligned node coordinates before fitting
    useEffect(() => {
        if (!nodesInitialized) return;
        const layoutChanged = prevLayoutKeyRef.current !== layoutKey;
        if (!hasInitialFitRef.current || layoutChanged) {
            let raf2 = 0;
            const raf1 = window.requestAnimationFrame(() => {
                raf2 = window.requestAnimationFrame(() => {
                    hasInitialFitRef.current = true;
                    prevLayoutKeyRef.current = layoutKey;
                    runProgrammaticFit(0);
                });
            });
            return () => {
                window.cancelAnimationFrame(raf1);
                if (raf2) window.cancelAnimationFrame(raf2);
            };
        }
    }, [layoutKey, nodesInitialized, runProgrammaticFit]);

    // Center on target node when focusTrigger changes without clobbering the peer pane
    useEffect(() => {
        if (!focusTrigger) return;
        const targetPos = positions[focusTrigger.taskId];
        if (!targetPos) return;
        if (programmaticTimerRef.current !== null) {
            window.clearTimeout(programmaticTimerRef.current);
        }
        isProgrammaticRef.current = true;
        gestureStartRef.current = null;
        followerAnchorRef.current = null;
        void Promise.resolve(
            reactFlow.setCenter?.(
                targetPos.x + COMPARE_NODE_WIDTH / 2,
                targetPos.y + COMPARE_NODE_HEIGHT / 2,
                { zoom: 1, duration: 220 },
            ),
        ).finally(() => {
            programmaticTimerRef.current = window.setTimeout(() => {
                const vp = reactFlow.getViewport?.();
                if (vp) {
                    lastViewportRef.current = vp;
                }
                isProgrammaticRef.current = false;
                programmaticTimerRef.current = null;
            }, 50);
        });
    }, [focusTrigger, positions, reactFlow]);

    // Fit entire graph independently in both panes when user clicks "重置视图"
    useEffect(() => {
        if (fitTrigger === 0) return;
        runProgrammaticFit(220);
    }, [fitTrigger, runProgrammaticFit]);

    // Apply gesture-scoped relative delta from the peer pane so divergent initial viewports never drift or compound
    useEffect(() => {
        if (!syncViewport || !syncDelta || syncDelta.leader === pane) {
            if (!syncViewport || !syncDelta) {
                followerAnchorRef.current = null;
            }
            return;
        }
        if (followerAnchorRef.current?.gestureId !== syncDelta.gestureId) {
            const liveViewport = reactFlow.getViewport?.() ?? lastViewportRef.current;
            followerAnchorRef.current = {
                gestureId: syncDelta.gestureId,
                viewport: liveViewport,
            };
        }
        const anchor = followerAnchorRef.current.viewport;
        const nextViewport: Viewport = {
            x: anchor.x + syncDelta.dx,
            y: anchor.y + syncDelta.dy,
            zoom: Math.max(0.15, Math.min(4, anchor.zoom * syncDelta.zoomScale)),
        };
        lastViewportRef.current = nextViewport;
        if (programmaticTimerRef.current !== null) {
            window.clearTimeout(programmaticTimerRef.current);
        }
        isProgrammaticRef.current = true;
        reactFlow.setViewport?.(nextViewport, { duration: 0 });
        programmaticTimerRef.current = window.setTimeout(() => {
            isProgrammaticRef.current = false;
            programmaticTimerRef.current = null;
        }, 40);
    }, [pane, reactFlow, syncDelta, syncViewport]);

    const focusedDiff = activeNodeId ? diffById.get(activeNodeId) : null;
    const missingInThisPane = Boolean(
        activeNodeId
        && !snapshotNodesById.has(activeNodeId)
        && focusedDiff,
    );

    const missingText = missingInThisPane
        ? pane === 'base'
            ? `节点「${activeNodeId}」在基准版本中尚不存在（对比版本新增）`
            : `节点「${activeNodeId}」在对比版本中已删除`
        : null;

    const hoverSummary = formatVersionTooltipSummary(version);

    return (
        <div className={`offline-compare-canvas-pane is-${pane}`}>
            <div className="offline-compare-pane-head">
                <VersionHoverTooltip version={version}>
                    <h3 className={hoverSummary ? 'has-tooltip' : undefined}>
                        <span className="offline-compare-pane-title">{roleTitle}</span>
                        <code>{formatRevisionTag(version.revision)}</code>
                        {version.onlineVersion != null ? (
                            <span className="offline-compare-pane-online">
                                v{version.onlineVersion}{version.currentOnline ? ' 线上' : ''}
                            </span>
                        ) : null}
                    </h3>
                </VersionHoverTooltip>
            </div>

            {missingText ? (
                <div className="offline-compare-missing-banner" role="status">
                    <AlertCircle size={13} aria-hidden="true" />
                    <span>{missingText}</span>
                </div>
            ) : null}

            <div className="offline-compare-reactflow-wrap">
                {nodes.length === 0 ? (
                    <div className="offline-compare-pane-empty">
                        <Crosshair size={20} aria-hidden="true" />
                        <span>该版本暂无编排节点</span>
                    </div>
                ) : null}

                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={COMPARE_NODE_TYPES}
                    proOptions={{ hideAttribution: true }}
                    fitView
                    fitViewOptions={COMPARE_FIT_VIEW_OPTIONS}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    onInit={(instance) => {
                        lastViewportRef.current = instance.getViewport();
                    }}
                    onNodeClick={(_event, clickedNode) => onFocusNode(clickedNode.id)}
                    onNodeDoubleClick={(_event, clickedNode) => onInspectNode(clickedNode.id)}
                    onMoveStart={(event, viewport) => {
                        if (!event || isProgrammaticRef.current) return;
                        const gestureId = onGestureStart();
                        if (gestureId == null) return;
                        lastViewportRef.current = viewport;
                        gestureStartRef.current = { gestureId, viewport };
                    }}
                    onMove={(event, viewport) => {
                        const prevViewport = lastViewportRef.current;
                        lastViewportRef.current = viewport;
                        if (!event || isProgrammaticRef.current) return;
                        let gesture = gestureStartRef.current;
                        if (!gesture) {
                            const gestureId = onGestureStart();
                            if (gestureId == null) return;
                            gesture = { gestureId, viewport: prevViewport };
                            gestureStartRef.current = gesture;
                        }
                        onPanDelta(gesture.gestureId, computePanDelta(gesture.viewport, viewport));
                    }}
                    onMoveEnd={(event, viewport) => {
                        lastViewportRef.current = viewport;
                        if (!event || isProgrammaticRef.current) {
                            return;
                        }
                        const gesture = gestureStartRef.current;
                        if (gesture) {
                            onPanDelta(gesture.gestureId, computePanDelta(gesture.viewport, viewport));
                        }
                        gestureStartRef.current = null;
                        onGestureEnd();
                    }}
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={20}
                        size={1.5}
                        color="rgba(120, 100, 80, 0.22)"
                    />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>
        </div>
    );
}

function computePanDelta(startViewport: Viewport, currentViewport: Viewport) {
    return {
        dx: currentViewport.x - startViewport.x,
        dy: currentViewport.y - startViewport.y,
        zoomScale: startViewport.zoom > 0
            ? currentViewport.zoom / startViewport.zoom
            : 1,
    };
}

function buildSourceSummary(
    node: OfflineFlowNode,
    dataSourceNames?: Record<number, string>,
): string {
    if (node.kind === 'TRANSFER' && node.transfer) {
        const src = node.transfer.source?.table || node.transfer.source?.database || '';
        const tgt = node.transfer.target?.table || node.transfer.target?.database || '';
        if (src || tgt) {
            return `${src || '?'} → ${tgt || '?'}`;
        }
    }
    if (node.dataSourceId != null) {
        return formatDataSourceDisplay(node.dataSourceId, node.dataSourceType, dataSourceNames);
    }
    if (node.scriptPath) {
        return node.scriptPath.split('/').pop() ?? node.scriptPath;
    }
    return '';
}
