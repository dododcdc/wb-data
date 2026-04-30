import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import { useNavigate, useBlocker } from 'react-router-dom';
import FlowCanvas from './FlowCanvas';
import '../core/RouteSkeletons.css';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import {
    AlertTriangle,
    ArrowUpRight,
    ChevronRight,
    Clock3,
    Database,
    FileCode2,
    FolderOpen,
    FolderPlus,
    GitCommitHorizontal,
    History,
    LoaderCircle,
    Pencil,
    Play,
    Plus,
    RefreshCcw,
    Save,
    Settings2,
    TerminalSquare,
    Trash2,
    X,
    Copy,
} from 'lucide-react';
import {
    commitOfflineRepo,
    createOfflineFolder,
    createOfflineDocumentDebugExecution,
    deleteOfflineFlow,
    deleteOfflineFolder,
    getOfflineExecution,
    getOfflineFlowContent,
    getOfflineFlowDocument,
    getOfflineRepoStatus,
    getOfflineRepoTree,
    getOfflineRepoRemote,
    getOfflineSchedule,
    listOfflineExecutions,
    pushOfflineRepo,
    renameOfflineFlow,
    renameOfflineFolder,
    saveOfflineFlowDocument,
    stopAllOfflineExecutions,
    stopOfflineExecution,
    updateOfflineSchedule,
    updateOfflineScheduleStatus,
    type OfflineExecutionDetail,
    type OfflineExecutionListItem,
    type OfflineFlowDocument,
    type OfflineFlowNodeKind,
    type OfflineFlowNode,
    type OfflineRepoStatus,
    type RemoteStatus,
    type OfflineRepoTreeNode,
    type OfflineRepoTreeResponse,
    type OfflineScheduleResponse,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SimpleSelect } from '../../components/SimpleSelect';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../utils/auth';
import { NodeEditorDialog } from './NodeEditorDialog';
import {
    applyCanvasStateToDocument,
    buildEdgesFromCanvasEdges,
    buildLayoutFromCanvasNodes,
} from './flowCanvasState';
import {
    buildRecoverySnapshotFromSession,
    createFlowDraftSession,
    forceOverwriteRebase,
    flushNodeEditorDraft,
    hasFlowDraftChanges,
    prepareSessionForLeave,
    rebaseFlowDraftSession,
    replaceFlowDraftWorkingDocument,
    resolveDraftConflict,
    type FlowDraftSession,
    type PendingNodeEditorDraft,
} from './flowDraftController';
import { createNodeEditorDraftScheduler } from './nodeEditorDraftScheduler';
import { isExecuteButtonDisabled } from './executionToolbarState';
import { buildDraftExecutionRequest } from './draftExecution';
import { 
    getExecutionPresentation, 
    getExecutionStatusLabel, 
    getTaskStatusIcon,
    isActiveStatus,
    isRunningStatus 
} from './executionPresentation';
import {
    findFirstNodeWithInvalidDataSource,
    validateSqlNodeDataSourceRequirement,
} from './nodeEditorDataSourceRules';
import { validateSaveFlowDependencies } from './saveFlowDependencyValidation';
import {
    getOfflineNodeDefaultScript,
    getOfflineNodeScriptExtension,
} from './offlineNodeKinds';
import {
    moveFolderRecoverySnapshots,
    moveRecoverySnapshot,
    readRecoverySnapshot,
    removeFolderRecoverySnapshots,
    removeRecoverySnapshot,
    writeRecoverySnapshot,
} from './recoverySnapshotStore';
import { clearDeletedFolderDraftState } from './deletedFolderDraftState';
import { finalizeNodeEditorDraftOnClose } from './nodeEditorCloseDraftState';
import { resolveSelectionStateAfterAddingNode } from './nodeSelectionState';
import { resolvePendingNodeEditorDraftAfterDocumentChange } from './pendingNodeEditorDraftState';
import { SaveConflictDialog } from './SaveConflictDialog';
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard';

import './OfflineWorkbench.css';

const EMPTY_SELECTED_TASK_IDS: string[] = [];
const NODE_EDITOR_DRAFT_FLUSH_DELAY_MS = 180;

interface SaveConflictState {
    path: string;
    pendingSession: FlowDraftSession;
}

function flattenDocumentNodes(document: OfflineFlowDocument | null) {
    return document?.stages.flatMap((stage) => stage.nodes) ?? [];
}

function resolveSelectedNodeId(document: OfflineFlowDocument | null, candidate: string | null) {
    const nodes = flattenDocumentNodes(document);
    if (nodes.length === 0) return null;
    if (candidate && nodes.some((node) => node.taskId === candidate)) {
        return candidate;
    }
    return nodes[0].taskId;
}

function resolveSelectedTaskIds(document: OfflineFlowDocument | null, candidates: string[]) {
    const validIds = new Set(flattenDocumentNodes(document).map((node) => node.taskId));
    return candidates.filter((taskId, index, array) => validIds.has(taskId) && array.indexOf(taskId) === index);
}

function formatDateTime(value: string | number | null | undefined) {
    if (!value) return '—';
    const date = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDuration(durationMs: number | null) {
    if (durationMs == null) return '—';
    if (durationMs < 1000) return `${durationMs}ms`;
    const seconds = durationMs / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1).replace(/\.0$/, '')}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
}

function StatusPill(props: { tone: 'neutral' | 'success' | 'danger' | 'active'; children: string }) {
    const { tone, children } = props;
    return <span className={`offline-pill is-${tone}`}>{children}</span>;
}

function collectTreeDirectoryIds(node: OfflineRepoTreeNode): string[] {
    return node.children.flatMap((child) => {
        if (child.kind !== 'DIRECTORY') {
            return [];
        }
        return [child.id, ...collectTreeDirectoryIds(child)];
    });
}

interface PathPickerNode {
    id: string;
    name: string;
    path: string;
    kind: 'ROOT' | 'DIRECTORY';
    children: PathPickerNode[];
}

function normalizeToPickerNodes(root: OfflineRepoTreeNode): PathPickerNode[] {
    return root.children
        .filter((child) => child.kind === 'DIRECTORY' && child.name !== 'scripts')
        .map((child) => pickerFromRepoNode(child));
}

function pickerFromRepoNode(node: OfflineRepoTreeNode): PathPickerNode {
    return {
        id: node.id,
        name: node.name,
        path: node.path,
        kind: node.kind as 'ROOT' | 'DIRECTORY',
        children: node.children
            .filter((child) => child.kind === 'DIRECTORY')
            .map(pickerFromRepoNode),
    };
}

interface PathPickerProps {
    rootNode: OfflineRepoTreeNode;
    selectedPath: string;
    onSelect: (path: string) => void;
}

interface PathPickerBranchProps {
    node: PathPickerNode;
    depth: number;
    selectedPath: string;
    onSelect: (path: string) => void;
}

function PathPicker({ rootNode, selectedPath, onSelect }: PathPickerProps) {
    const [search, setSearch] = useState('');
    const [rootExpanded, setRootExpanded] = useState(true);

    const filteredNodes = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return normalizeToPickerNodes(rootNode);

        const flatPaths: { label: string, path: string }[] = [];
        const extract = (nodes: PathPickerNode[]) => {
            nodes.forEach(n => {
                const relative = n.path.replace(/^_flows\/?/, '');
                if (relative.toLowerCase().includes(query)) {
                    flatPaths.push({ label: relative, path: relative });
                }
                extract(n.children);
            });
        };
        extract(normalizeToPickerNodes(rootNode));
        return flatPaths;
    }, [rootNode, search]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input 
                placeholder="搜索目录..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
                style={{ height: 32, fontSize: '0.84rem' }}
            />
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, maxHeight: 200, overflowY: 'auto', background: 'var(--color-surface)', padding: '8px 0' }}>
                {search ? (
                    filteredNodes.length > 0 ? (
                        (filteredNodes as { label: string, path: string }[]).map(item => (
                            <button
                                key={item.path}
                                type="button"
                                className={`offline-tree-row${selectedPath === item.path ? ' is-active' : ''}`}
                                style={{ paddingLeft: 12 }}
                                onClick={() => onSelect(item.path)}
                            >
                                <span className="offline-tree-row-icon"><FolderOpen size={13} /></span>
                                <span className="offline-tree-row-label">{item.label}</span>
                            </button>
                        ))
                    ) : (
                        <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                            无匹配的目录
                        </div>
                    )
                ) : (
                    <div className="offline-tree-root">
                        <button
                            type="button"
                            className={`offline-tree-row${!selectedPath ? ' is-active' : ''}`}
                            style={{ paddingLeft: 6 }}
                            onClick={() => { onSelect(''); setRootExpanded(!rootExpanded); }}
                        >
                            <span className={`offline-tree-row-caret${rootExpanded ? ' is-expanded' : ''}`}>
                                <ChevronRight size={14} />
                            </span>
                            <span className="offline-tree-row-icon"><FolderOpen size={13} /></span>
                            <span className="offline-tree-row-label">{rootNode.name}</span>
                        </button>
                        {rootExpanded && (
                            <div className="offline-tree-children">
                                {(filteredNodes as PathPickerNode[]).map(child => (
                                    <PathPickerBranch
                                        key={child.id}
                                        node={child}
                                        depth={1}
                                        selectedPath={selectedPath}
                                        onSelect={onSelect}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function PathPickerBranch({ node, depth, selectedPath, onSelect }: PathPickerBranchProps) {
    const relativePath = node.path.replace(/^_flows\/?/, '');
    const isSelected = selectedPath === relativePath || (selectedPath === '' && relativePath === '');
    const hasChildren = node.children.length > 0;
    const [expanded, setExpanded] = useState(
        selectedPath !== '' && selectedPath.startsWith(relativePath)
    );
    const indentStyle = { paddingLeft: `${depth * 14 + 6}px` };

    return (
        <div className="offline-tree-branch">
            <button
                type="button"
                className={`offline-tree-row is-directory${isSelected ? ' is-active' : ''}`}
                style={indentStyle}
                onClick={() => {
                    onSelect(relativePath);
                    if (hasChildren) setExpanded(!expanded);
                }}
            >
                {hasChildren ? (
                    <span className={`offline-tree-row-caret${expanded ? ' is-expanded' : ''}`}>
                        <ChevronRight size={14} />
                    </span>
                ) : (
                    <span className="offline-tree-row-spacer" />
                )}
                <span className="offline-tree-row-icon">
                    <FolderOpen size={13} />
                </span>
                <span className="offline-tree-row-label">{node.name}</span>
            </button>
            {hasChildren && expanded && (
                <div className="offline-tree-children">
                    {node.children.map((child) => (
                        <PathPickerBranch
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            selectedPath={selectedPath}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface RepoTreeBranchProps {
    node: OfflineRepoTreeNode;
    depth: number;
    activeFlowPath: string | null;
    expandedIds: string[];
    onToggle: (nodeId: string) => void;
    onOpenFlow: (path: string) => void;
    onContextMenu: (event: React.MouseEvent, node: OfflineRepoTreeNode) => void;
}

function GitPushIcon({ dirty }: { dirty: boolean }) {
    return (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
            <ArrowUpRight size={16} />
            {dirty && <span className="offline-toolbar-dot is-brand" />}
        </span>
    );
}

function RepoTreeBranch(props: RepoTreeBranchProps) {
    const { node, depth, activeFlowPath, expandedIds, onToggle, onOpenFlow, onContextMenu } = props;
    const hasChildren = node.children.length > 0;
    const expanded = expandedIds.includes(node.id);
    const indentStyle = { paddingLeft: `${depth * 14}px` };

    if (node.kind === 'FLOW') {
        return (
            <button
                type="button"
                className={`offline-tree-row is-flow${node.path === activeFlowPath ? ' is-active' : ''}`}
                style={indentStyle}
                onClick={() => onOpenFlow(node.path)}
                onContextMenu={(e) => onContextMenu(e, node)}
            >
                <span className="offline-tree-row-icon">
                    <FileCode2 size={14} />
                </span>
                <span className="offline-tree-row-label">{node.name}</span>
            </button>
        );
    }

    return (
        <div className="offline-tree-branch">
            <button
                type="button"
                className={`offline-tree-row is-directory${expanded ? ' is-expanded' : ''}`}
                style={indentStyle}
                onClick={() => onToggle(node.id)}
                onContextMenu={(e) => onContextMenu(e, node)}
            >
                {hasChildren ? (
                    <span className={`offline-tree-row-caret${expanded ? ' is-expanded' : ''}`}>
                        <ChevronRight size={14} />
                    </span>
                ) : (
                    <span className="offline-tree-row-spacer" />
                )}
                <span className="offline-tree-row-icon">
                    <FolderOpen size={14} />
                </span>
                <span className="offline-tree-row-label">{node.name}</span>
            </button>
            {hasChildren && expanded ? (
                <div className="offline-tree-children">
                    {node.children.map((child) => (
                        <RepoTreeBranch
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            activeFlowPath={activeFlowPath}
                            expandedIds={expandedIds}
                            onToggle={onToggle}
                            onOpenFlow={onOpenFlow}
                            onContextMenu={onContextMenu}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

interface ExecutionDialogProps {
    open: boolean;
    flowPath: string | null;
    executions: OfflineExecutionListItem[];
    loading: boolean;
    detail: OfflineExecutionDetail | null;
    detailLoading: boolean;
    activeExecutionId: string | null;
    actionPending: string | null;
    requestedByFilter: number | null;
    currentUserId: number | null;
    onOpenChange: (open: boolean) => void;
    onRefresh: () => void;
    onSelectExecution: (executionId: string) => void;
    onStopExecution: (executionId: string) => void;
    onStopAll: () => void;
    onOpenExecutionPage: (executionId: string) => void;
    onOpenTaskLogs: (executionId: string, taskId: string) => void;
    onRequestedByFilterChange: (requestedBy: number | null) => void;
}

function ExecutionDialog(props: ExecutionDialogProps) {
    const {
        open,
        executions,
        loading,
        detail,
        detailLoading,
        activeExecutionId,
        actionPending,
        requestedByFilter,
        currentUserId,
        onOpenChange,
        onRefresh,
        onSelectExecution,
        onStopAll,
        onOpenTaskLogs,
        onRequestedByFilterChange,
    } = props;
    const requestedByOptions = currentUserId == null
        ? [{ label: '全部用户', value: 'ALL' }]
        : [
            { label: '全部用户', value: 'ALL' },
            { label: '仅我', value: 'ME' },
        ];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPortal>
                <DialogOverlay className="offline-dialog-backdrop" />
                <DialogContent className="offline-dialog-positioner">
                    <div className="offline-dialog-card offline-execution-dialog">
                        <div className="offline-dialog-header hidden" />

                        <div className="offline-dialog-toolbar">
                            <div className="offline-execution-toolbar-left">
                                <label className="offline-execution-filter">
                                    <span>用户</span>
                                    <div className="offline-execution-filter-control">
                                        <SimpleSelect
                                            options={requestedByOptions}
                                            value={requestedByFilter == null ? 'ALL' : 'ME'}
                                            menuPlacement="down"
                                            onChange={(value) => onRequestedByFilterChange(value === 'ME' ? currentUserId : null)}
                                        />
                                    </div>
                                </label>
                            </div>
                            <div className="offline-execution-toolbar-right">
                                <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                                    <RefreshCcw size={14} />
                                    刷新
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="offline-button-stop"
                                    onClick={onStopAll}
                                    disabled={executions.every((item) => !isActiveStatus(item.status)) || actionPending === 'ALL'}
                                >
                                    {actionPending === 'ALL' ? <LoaderCircle size={14} className="offline-spin" /> : <TerminalSquare size={14} />}
                                    停止
                                </Button>
                                <button
                                    className="offline-dialog-close-inline"
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => onOpenChange(false)}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="offline-execution-layout">
                            <section className="offline-execution-list">
                                {loading ? (
                                    <div className="offline-list-placeholder">正在加载执行记录...</div>
                                ) : executions.length === 0 ? (
                                    <div className="offline-list-placeholder">当前 Flow 还没有执行记录。</div>
                                ) : (
                                    executions.map((item) => {
                                        const presentation = getExecutionPresentation(item.status);
                                        return (
                                            <button
                                                key={item.executionId}
                                                type="button"
                                                className={`offline-execution-row is-${presentation.dotTone}${item.executionId === activeExecutionId ? ' is-active' : ''}`}
                                                onClick={() => onSelectExecution(item.executionId)}
                                            >
                                                <div className="offline-execution-row-main">
                                                    <div className="offline-execution-row-title">
                                                        <span className={`offline-execution-dot is-${presentation.dotTone}`} aria-hidden="true" />
                                                        <strong>{item.displayName || `ID: ${item.executionId.slice(-8)}`}</strong>
                                                    </div>
                                                    <div className="offline-execution-row-meta">
                                                        <span className="offline-execution-row-meta-item">
                                                            {formatDateTime(item.startDate)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </section>

                            <section className="offline-execution-detail">
                                {detailLoading ? (
                                    <div className="offline-list-placeholder">正在加载执行详情...</div>
                                ) : !detail ? (
                                    <div className="offline-list-placeholder">选择一条执行记录查看概览。</div>
                                ) : (
                                    (() => {
                                        return (
                                            <>
                                                <div className="offline-detail-body">
                                                    <div className="offline-detail-meta-minimal">
                                                        <span title="开始时间">{formatDateTime(detail.startDate ?? detail.createdAt)}</span>
                                                        <span className="meta-sep">→</span>
                                                        <span title="结束时间">{detail.endDate ? formatDateTime(detail.endDate) : '进行中'}</span>
                                                        <span className="meta-divider">|</span>
                                                        <span className="offline-branch-badge-tiny">{detail.branch ?? '—'}</span>
                                                        <span className="meta-divider">|</span>
                                                        <code className="meta-id-tiny">{detail.executionId}</code>
                                                        <Button 
                                                            variant="ghost" 
                                                            size="sm" 
                                                            className="h-4 w-4 p-0 ml-1 opacity-50 hover:opacity-100" 
                                                            onClick={() => navigator.clipboard.writeText(detail.executionId)}
                                                        >
                                                            <Copy size={10} />
                                                        </Button>
                                                    </div>

                                                {detail.taskRuns && detail.taskRuns.filter(t => !t.taskId.startsWith('parallel_') && t.taskId !== 'flow_dag').length > 0 && (
                                                    <div className="offline-detail-tasks">
                                                        <div className="offline-detail-tasks-header">
                                                            <span>节点执行详情</span>
                                                            <em>{detail.taskRuns.filter(t => !t.taskId.startsWith('parallel_') && t.taskId !== 'flow_dag').length} 个节点</em>
                                                        </div>
                                                        <div className="offline-detail-tasks-list">
                                                            <div className="offline-tasks-list-thead">
                                                                <div className="col-node">节点</div>
                                                                <div className="col-time">开始时间</div>
                                                                <div className="col-time">结束时间</div>
                                                                <div className="col-duration">耗时</div>
                                                                <div className="col-progress">进度</div>
                                                                <div className="col-status">状态</div>
                                                                <div className="col-actions"></div>
                                                            </div>
                                                            <div className="offline-tasks-list-tbody">
                                                                {detail.taskRuns
                                                                    .filter(task => !task.taskId.startsWith('parallel_') && task.taskId !== 'flow_dag')
                                                                    .map((task) => {
                                                                        const StatusIcon = getTaskStatusIcon(task.status);
                                                                    const isRunning = isRunningStatus(task.status);
                                                                    const duration = (task.startDate && task.endDate) 
                                                                        ? new Date(task.endDate).getTime() - new Date(task.startDate).getTime()
                                                                        : (task.startDate && isRunning)
                                                                            ? Date.now() - new Date(task.startDate).getTime()
                                                                            : null;

                                                                    return (
                                                                        <div key={task.taskId} className="offline-tasks-list-row">
                                                                            <div className="col-node" title={task.taskId}>
                                                                                <strong>{task.taskId}</strong>
                                                                            </div>
                                                                            <div className="col-time">
                                                                                {task.startDate ? formatDateTime(task.startDate).split(' ')[1] : '—'}
                                                                            </div>
                                                                            <div className="col-time">
                                                                                {task.endDate ? formatDateTime(task.endDate).split(' ')[1] : '—'}
                                                                            </div>
                                                                            <div className="col-duration">
                                                                                {formatDuration(duration)}
                                                                            </div>
                                                                            <div className="col-progress">
                                                                                <div className="task-progress-mini">
                                                                                    {task.status === 'SUCCESS' ? (
                                                                                        <span className="progress-value is-done">100%</span>
                                                                                    ) : isRunning ? (
                                                                                        <div className="progress-bar-tiny">
                                                                                            <div className="progress-bar-inner is-running" />
                                                                                        </div>
                                                                                    ) : (
                                                                                        <span className="progress-value">0%</span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            <div className="col-status">
                                                                                <div className={`offline-status-badge is-${task.status.toLowerCase()}`}>
                                                                                    <StatusIcon 
                                                                                        size={12} 
                                                                                        className={`offline-task-icon${isRunning ? ' is-animated' : ''}`} 
                                                                                    />
                                                                                    <span>{getExecutionStatusLabel(task.status)}</span>
                                                                                </div>
                                                                            </div>
                                                                            <div className="col-actions">
                                                                                <Button
                                                                                    type="button"
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    style={{ height: '24px', padding: '0 8px', fontSize: '0.72rem' }}
                                                                                    onClick={() => onOpenTaskLogs(detail.executionId, task.taskId)}
                                                                                >
                                                                                    日志
                                                                                </Button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    )}
                                                </div>
                                            </>
                                        );
                                    })()
                                )}
                            </section>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}

interface ScheduleDialogProps {
    open: boolean;
    schedule: OfflineScheduleResponse | null;
    cron: string;
    timezone: string;
    loading: boolean;
    saving: boolean;
    path: string | null;
    onOpenChange: (open: boolean) => void;
    onCronChange: (value: string) => void;
    onTimezoneChange: (value: string) => void;
    onSave: () => void;
    onToggle: (enabled: boolean) => void;
}

function ScheduleDialog(props: ScheduleDialogProps) {
    const {
        open,
        schedule,
        cron,
        timezone,
        loading,
        saving,
        path,
        onOpenChange,
        onCronChange,
        onTimezoneChange,
        onSave,
        onToggle,
    } = props;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPortal>
                <DialogOverlay className="offline-dialog-backdrop" />
                <DialogContent className="offline-dialog-positioner">
                    <div className="offline-dialog-card offline-schedule-dialog">
                        <div className="offline-dialog-header">
                            <div>
                                <DialogTitle className="offline-dialog-title">调度配置</DialogTitle>
                                <DialogDescription className="offline-dialog-description">
                                    {path ?? '尚未选择 Flow'}
                                </DialogDescription>
                            </div>
                            <button
                                className="offline-dialog-close"
                                type="button"
                                aria-label="关闭调度配置"
                                onClick={() => onOpenChange(false)}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="offline-schedule-meta">
                            {loading ? (
                                <div className="offline-list-placeholder">正在读取当前调度配置...</div>
                            ) : schedule ? (
                                <>
                                    <StatusPill tone={schedule.enabled ? 'success' : 'neutral'}>
                                        {schedule.enabled ? '已启用' : '已停用'}
                                    </StatusPill>
                                    <span>Trigger：{schedule.triggerId}</span>
                                    <span>最近版本：{schedule.contentHash.slice(0, 12)}</span>
                                </>
                            ) : (
                                <span>当前 Flow 还没有 Schedule trigger，保存后会自动创建。</span>
                            )}
                        </div>

                        <div className="offline-form-grid">
                            <label className="offline-field">
                                <span>Cron 表达式</span>
                                <Input
                                    value={cron}
                                    placeholder="例如：0 10 * * *"
                                    onChange={(event) => onCronChange(event.target.value)}
                                    disabled={saving}
                                />
                            </label>
                            <label className="offline-field">
                                <span>时区</span>
                                <Input
                                    value={timezone}
                                    placeholder="例如：Asia/Shanghai"
                                    onChange={(event) => onTimezoneChange(event.target.value)}
                                    disabled={saving}
                                />
                            </label>
                        </div>

                        <div className="offline-dialog-actions">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onToggle(!(schedule?.enabled ?? false))}
                                disabled={saving || loading || !schedule}
                            >
                                <Clock3 size={14} />
                                {schedule?.enabled ? '停用调度' : '启用调度'}
                            </Button>
                            <Button
                                type="button"
                                onClick={onSave}
                                disabled={saving || loading || cron.trim().length === 0}
                            >
                                {saving ? <LoaderCircle size={14} className="offline-spin" /> : <Save size={14} />}
                                保存调度
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}

export default function OfflineWorkbench() {
    const navigate = useNavigate();
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const currentUser = useAuthStore((state) => state.userInfo);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const groupId = currentGroup?.id ?? null;
    const canWrite = systemAdmin || permissions.includes('offline.write');
    const defaultTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
    const { showFeedback } = useOperationFeedback();

    const [repoStatus, setRepoStatus] = useState<OfflineRepoStatus | null>(null);
    const [repoLoading, setRepoLoading] = useState(false);
    const [repoTree, setRepoTree] = useState<OfflineRepoTreeResponse | null>(null);
    const [treeLoading, setTreeLoading] = useState(false);
    const [, setRemoteStatus] = useState<RemoteStatus | null>(null);
    const [pushLoading, setPushLoading] = useState(false);
    const [commitDialogOpen, setCommitDialogOpen] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');
    const [committing, setCommitting] = useState(false);
    const [expandedTreeIds, setExpandedTreeIds] = useState<string[]>([]);
    const [activeFlowPath, setActiveFlowPath] = useState<string | null>(null);
    const [flowLoading, setFlowLoading] = useState(false);
    const [savingFlow, setSavingFlow] = useState(false);
    const [draftSession, setDraftSession] = useState<FlowDraftSession | null>(null);
    const [saveConflictState, setSaveConflictState] = useState<SaveConflictState | null>(null);
    const [saveConflictPending, setSaveConflictPending] = useState(false);
    const [executionDialogOpen, setExecutionDialogOpen] = useState(false);
    const [executions, setExecutions] = useState<OfflineExecutionListItem[]>([]);
    const [executionsLoading, setExecutionsLoading] = useState(false);
    const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
    const [executionDetail, setExecutionDetail] = useState<OfflineExecutionDetail | null>(null);
    const [executionDetailLoading, setExecutionDetailLoading] = useState(false);
    const [executionActionPending, setExecutionActionPending] = useState<string | null>(null);
    const [executionRequestedByFilter, setExecutionRequestedByFilter] = useState<number | null>(null);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [schedule, setSchedule] = useState<OfflineScheduleResponse | null>(null);
    const [scheduleLoading, setScheduleLoading] = useState(false);
    const [scheduleSaving, setScheduleSaving] = useState(false);
    const [scheduleCron, setScheduleCron] = useState('');
    const [scheduleTimezone, setScheduleTimezone] = useState(defaultTimezone);
    const [newFlowDialogOpen, setNewFlowDialogOpen] = useState(false);
    const [newFlowName, setNewFlowName] = useState('');
    const [newFlowCreating, setNewFlowCreating] = useState(false);
    const [newFlowParentPath, setNewFlowParentPath] = useState(''); // e.g. "_flows" or "_flows/subdir"
    const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderCreating, setNewFolderCreating] = useState(false);
    const [newFolderParentPath, setNewFolderParentPath] = useState(''); // e.g. "_flows"
    const [newItemMenuOpen, setNewItemMenuOpen] = useState(false);
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [contextMenuNode, setContextMenuNode] = useState<OfflineRepoTreeNode | null>(null);
    const [deleteFlowDialogOpen, setDeleteFlowDialogOpen] = useState(false);
    const [deleteFlowName, setDeleteFlowName] = useState('');
    const [deleteFlowPath, setDeleteFlowPath] = useState('');
    const [deleteFlowLoading, setDeleteFlowLoading] = useState(false);

    const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
    const [deleteFolderName, setDeleteFolderName] = useState('');
    const [deleteFolderPath, setDeleteFolderPath] = useState('');
    const [deleteFolderLoading, setDeleteFolderLoading] = useState(false);

    const [renameFlowDialogOpen, setRenameFlowDialogOpen] = useState(false);
    const [renameFlowName, setRenameFlowName] = useState('');
    const [renameFlowOriginalName, setRenameFlowOriginalName] = useState('');
    const [renameFlowPath, setRenameFlowPath] = useState('');
    const [renameFlowLoading, setRenameFlowLoading] = useState(false);

    const [renameFolderDialogOpen, setRenameFolderDialogOpen] = useState(false);
    const [renameFolderName, setRenameFolderName] = useState('');
    const [renameFolderOriginalName, setRenameFolderOriginalName] = useState('');
    const [renameFolderPath, setRenameFolderPath] = useState('');
    const [renameFolderLoading, setRenameFolderLoading] = useState(false);
    const [nodeEditorOpen, setNodeEditorOpen] = useState(false);
    const [nodeEditorContent, setNodeEditorContent] = useState('');
    const canvasNodesRef = useRef<Node[]>([]);
    const canvasEdgesRef = useRef<Edge[]>([]);
    const canvasBoardRef = useRef<HTMLDivElement>(null);
    const previousGroupIdRef = useRef<number | null>(groupId);
    const currentGroupIdRef = useRef<number | null>(groupId);
    const groupActionVersionRef = useRef(0);
    const pendingNodeEditorDraftRef = useRef<PendingNodeEditorDraft | null>(null);
    const draftSessionRef = useRef<FlowDraftSession | null>(null);
    const openFlowDocumentRef = useRef<(pathValue: string, options?: { preferRecoverySnapshot?: boolean }) => Promise<boolean>>(async () => false);
    const leaveCurrentFlowRef = useRef<((session: FlowDraftSession | null, groupIdValue?: number | null) => void) | null>(null);
    const nodeEditorDraftSchedulerRef = useRef<ReturnType<typeof createNodeEditorDraftScheduler> | null>(null);
    const [pendingNavigation, setPendingNavigation] = useState<{
        type: 'flow' | 'router';
        flowPath?: string;
        blocker?: any;
    } | null>(null);

    if (!nodeEditorDraftSchedulerRef.current) {
        nodeEditorDraftSchedulerRef.current = createNodeEditorDraftScheduler({
            delayMs: NODE_EDITOR_DRAFT_FLUSH_DELAY_MS,
            onFlush: (draft) => {
                setDraftSession((current) => current
                    ? flushNodeEditorDraft(current, draft)
                    : current);
            },
        });
    }

    const flowDocument = draftSession?.workingDraft ?? null;
    const activeNodeId = draftSession?.selectedNodeId ?? null;
    const selectedTaskIds = draftSession?.selectedTaskIds ?? EMPTY_SELECTED_TASK_IDS;
    const staleDraft = draftSession?.conflict ?? null;
    const activeNode = useMemo(() => flattenDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null, [activeNodeId, flowDocument]);
    const nodeCount = useMemo(() => flattenDocumentNodes(flowDocument).length, [flowDocument]);
    const isDirty = draftSession !== null && hasFlowDraftChanges(draftSession);

    useBeforeUnloadGuard(isDirty);

    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) =>
            isDirty && currentLocation.pathname !== nextLocation.pathname
    );

    useEffect(() => {
        if (blocker.state === 'blocked') {
            setPendingNavigation({ type: 'router', blocker });
        }
    }, [blocker]);

    const nodeIssues = useMemo(() => {
        if (!flowDocument) return {};
        const issues: Record<string, string | null> = {};
        flattenDocumentNodes(flowDocument).forEach(node => {
            const validation = validateSqlNodeDataSourceRequirement({
                kind: node.kind,
                dataSourceId: node.dataSourceId,
                dataSourceType: node.dataSourceType,
                strict: true,
            });
            if (!validation.allowed && validation.feedback) {
                issues[node.taskId] = validation.feedback.detail || validation.feedback.title;
            }
        });
        return issues;
    }, [flowDocument]);

    const nodeStatuses = useMemo(() => {
        if (!executionDetail?.taskRuns) return {};
        const statuses: Record<string, string> = {};
        executionDetail.taskRuns.forEach((run) => {
            statuses[run.taskId] = run.status;
        });
        return statuses;
    }, [executionDetail]);
    const branchLabel = repoStatus?.gitInitialized ? repoStatus.branch ?? 'main' : '未初始化';

    useEffect(() => {
        draftSessionRef.current = draftSession;
    }, [draftSession]);

    useEffect(() => useAuthStore.subscribe((state, previousState) => {
        const nextGroupId = state.currentGroup?.id ?? null;
        const previousGroupId = previousState.currentGroup?.id ?? null;
        if (nextGroupId === previousGroupId) return;
        currentGroupIdRef.current = nextGroupId;
        groupActionVersionRef.current += 1;
    }), []);

    if (currentGroupIdRef.current !== groupId) {
        currentGroupIdRef.current = groupId;
        groupActionVersionRef.current += 1;
    }

    useEffect(() => () => {
        nodeEditorDraftSchedulerRef.current?.cancel();
    }, []);

    const captureGroupActionGuard = useCallback((expectedGroupId: number | null) => {
        const version = groupActionVersionRef.current;
        return () => currentGroupIdRef.current === expectedGroupId && groupActionVersionRef.current === version;
    }, []);

    const refreshRepoStatus = useCallback(async () => {
        if (!groupId) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setRepoLoading(true);
        try {
            const nextStatus = await getOfflineRepoStatus(groupId);
            if (!isCurrentGroupAction()) return;
            setRepoStatus(nextStatus);
        } catch (error) {
            if (!isCurrentGroupAction()) return;
            showFeedback({
                tone: 'error',
                title: '仓库状态读取失败',
                detail: getErrorMessage(error, '暂时无法读取本地仓库状态。'),
            });
        } finally {
            if (isCurrentGroupAction()) {
                setRepoLoading(false);
            }
        }
    }, [captureGroupActionGuard, groupId, showFeedback]);

    const refreshRepoTree = useCallback(async () => {
        if (!groupId) return;
        setTreeLoading(true);
        try {
            const nextTree = await getOfflineRepoTree(groupId);
            setRepoTree(nextTree);
            setExpandedTreeIds([nextTree.root.id, ...collectTreeDirectoryIds(nextTree.root)]);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '项目树读取失败',
                detail: getErrorMessage(error, '暂时无法读取本地仓库目录树。'),
            });
        } finally {
            setTreeLoading(false);
        }
    }, [groupId, showFeedback]);

    const refreshRemoteStatus = useCallback(async () => {
        if (!groupId) return;
        try {
            setRemoteStatus(await getOfflineRepoRemote(groupId));
        } catch {
            setRemoteStatus(null);
        }
    }, [groupId]);

    const refreshWorkspace = useCallback(async () => {
        await Promise.all([
            refreshRepoStatus(),
            refreshRepoTree(),
            refreshRemoteStatus(),
        ]);
    }, [refreshRepoStatus, refreshRepoTree, refreshRemoteStatus]);

    const loadScheduleSnapshot = useCallback(async (path: string) => {
        if (!groupId) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setScheduleLoading(true);
        try {
            const nextSchedule = await getOfflineSchedule(groupId, path);
            if (!isCurrentGroupAction()) return;
            setSchedule(nextSchedule);
            setScheduleCron(nextSchedule.cron);
            setScheduleTimezone(nextSchedule.timezone ?? defaultTimezone);
        } catch (error) {
            if (!isCurrentGroupAction()) return;
            if (error instanceof AxiosError && error.response?.status === 404) {
                setSchedule(null);
                setScheduleCron('');
                setScheduleTimezone(defaultTimezone);
                return;
            }
            showFeedback({
                tone: 'error',
                title: '调度配置读取失败',
                detail: getErrorMessage(error, '暂时无法读取当前 Flow 的调度配置。'),
            });
        } finally {
            if (isCurrentGroupAction()) {
                setScheduleLoading(false);
            }
        }
    }, [captureGroupActionGuard, defaultTimezone, groupId, showFeedback]);

    const setDraftSelectedNodeId = useCallback((nextSelectedNodeId: string | null) => {
        setDraftSession((current) => current ? { ...current, selectedNodeId: nextSelectedNodeId } : current);
    }, []);

    const setDraftSelectedTaskIds = useCallback((nextValue: string[] | ((current: string[]) => string[])) => {
        setDraftSession((current) => {
            if (!current) return current;
            const nextSelectedTaskIds = typeof nextValue === 'function' ? nextValue(current.selectedTaskIds) : nextValue;
            return {
                ...current,
                selectedTaskIds: [...nextSelectedTaskIds],
            };
        });
    }, []);

    const applyFlowDocumentPayload = useCallback((
        path: string,
        payload: OfflineFlowDocument,
        options?: { preferRecoverySnapshot?: boolean }
    ) => {
        const snapshot = groupId && (options?.preferRecoverySnapshot ?? true)
            ? readRecoverySnapshot(groupId, path)
            : null;
        const nextSession = createFlowDraftSession({
            path,
            serverDocument: payload,
            snapshot,
        });
        pendingNodeEditorDraftRef.current = null;
        setActiveFlowPath(path);
        setDraftSession(nextSession);
    }, [groupId]);

    const leaveCurrentFlow = useCallback((session: FlowDraftSession | null, groupIdValue: number | null = groupId) => {
        if (!groupIdValue || !session) return null;
        nodeEditorDraftSchedulerRef.current?.cancel();
        const result = prepareSessionForLeave(session, pendingNodeEditorDraftRef.current, Date.now());
        setDraftSession(result.nextSession);
        pendingNodeEditorDraftRef.current = null;
        if (result.snapshot) {
            writeRecoverySnapshot(groupIdValue, session.path, result.snapshot);
        } else if (session.conflict) {
            writeRecoverySnapshot(groupIdValue, session.path, session.conflict.snapshot);
        } else {
            removeRecoverySnapshot(groupIdValue, session.path);
        }
        return result;
    }, [groupId]);

    useEffect(() => {
        leaveCurrentFlowRef.current = leaveCurrentFlow;
    }, [leaveCurrentFlow]);

    const openFlowDocument = useCallback(async (pathValue: string, options?: { preferRecoverySnapshot?: boolean; force?: boolean }) => {
        if (!groupId) return false;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        const normalizedPath = pathValue.trim();
        let didApplyFlowDocument = false;
        if (!normalizedPath) {
            return false;
        }

        if (draftSession && draftSession.path !== normalizedPath) {
            if (!options?.force && isDirty) {
                setPendingNavigation({ type: 'flow', flowPath: normalizedPath });
                return false;
            }
            leaveCurrentFlow(draftSession);
        }

        setFlowLoading(true);
        try {
            const payload = await getOfflineFlowDocument(groupId, normalizedPath);
            if (!isCurrentGroupAction()) return false;
            applyFlowDocumentPayload(normalizedPath, payload, options);
            didApplyFlowDocument = true;
            await loadScheduleSnapshot(normalizedPath);
            if (!isCurrentGroupAction()) return false;
            return true;
        } catch (error) {
            if (!isCurrentGroupAction()) return false;
            if (didApplyFlowDocument) {
                return true;
            }
            showFeedback({
                tone: 'error',
                title: 'Flow 打开失败',
                detail: getErrorMessage(error, '请检查路径是否存在，或稍后再试。'),
            });
            return false;
        } finally {
            if (isCurrentGroupAction()) {
                setFlowLoading(false);
            }
        }
    }, [applyFlowDocumentPayload, captureGroupActionGuard, draftSession, groupId, leaveCurrentFlow, loadScheduleSnapshot, showFeedback]);

    useEffect(() => {
        openFlowDocumentRef.current = openFlowDocument;
    }, [openFlowDocument]);

    useEffect(() => {
        const previousGroupId = previousGroupIdRef.current;
        if (previousGroupId !== null && previousGroupId !== groupId && draftSessionRef.current) {
            leaveCurrentFlow(draftSessionRef.current, previousGroupId);
        }
        previousGroupIdRef.current = groupId;

        setActiveFlowPath(null);
        setFlowLoading(false);
        setDraftSession(null);
        setSaveConflictState(null);
        setSaveConflictPending(false);
        pendingNodeEditorDraftRef.current = null;

        if (!groupId) return;
        void refreshWorkspace();
    }, [groupId, leaveCurrentFlow, refreshWorkspace]);

    useEffect(() => {
        if (!groupId || !draftSession) return;
        const handleBeforeUnload = () => {
            leaveCurrentFlow(draftSessionRef.current);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [draftSession, groupId, leaveCurrentFlow]);

    const handlePush = useCallback(async () => {
        if (!groupId) return;
        setPushLoading(true);
        try {
            const result = await pushOfflineRepo(groupId);
            if (result.success) {
                showFeedback({ tone: 'success', title: result.message, detail: '' });
                await refreshRemoteStatus();
                await refreshRepoStatus();
            } else {
                showFeedback({ tone: 'error', title: result.message, detail: '' });
            }
        } catch (error) {
            showFeedback({ tone: 'error', title: '推送失败', detail: getErrorMessage(error, '推送失败，请稍后重试') });
        } finally {
            setPushLoading(false);
        }
    }, [groupId, showFeedback, refreshRemoteStatus, refreshRepoStatus]);

    const handleCommit = useCallback(async () => {
        if (!groupId) return;
        const invalidNode = findFirstNodeWithInvalidDataSource(flowDocument);
        if (invalidNode) {
            const validation = validateSqlNodeDataSourceRequirement({
                kind: invalidNode.kind,
                dataSourceId: invalidNode.dataSourceId,
                dataSourceType: invalidNode.dataSourceType,
                strict: true,
            });
            if (!validation.allowed && validation.feedback) {
                showFeedback(validation.feedback);
                return;
            }
        }
        setCommitting(true);
        try {
            const result = await commitOfflineRepo(groupId, commitMessage);
            if (result.success) {
                showFeedback({ tone: 'success', title: result.message, detail: '' });
                setCommitDialogOpen(false);
                setCommitMessage('');
                await refreshRepoStatus();
            } else {
                showFeedback({ tone: 'error', title: result.message, detail: '' });
            }
        } catch (error) {
            showFeedback({ tone: 'error', title: '版本提交失败', detail: getErrorMessage(error, '提交失败，请稍后重试') });
        } finally {
            setCommitting(false);
        }
    }, [groupId, flowDocument, commitMessage, showFeedback, refreshRepoStatus]);

    const handleCreateFlow = useCallback(async () => {
        if (!groupId || !newFlowName.trim()) return;
        const name = newFlowName.trim();
        // Strip _flows/ prefix since newFlowParentPath may already contain it (from PathPicker)
        const parentPathClean = newFlowParentPath.replace(/^_flows\/?/, '');
        const parentPath = parentPathClean ? `${parentPathClean}/${name}` : name;
        const path = `_flows/${parentPath}/flow.yaml`;
        setNewFlowCreating(true);
        try {
            await saveOfflineFlowDocument({
                groupId,
                path,
                documentHash: '',
                documentUpdatedAt: 0,
                stages: [],
                edges: [],
                layout: {},
            });
            setNewFlowDialogOpen(false);
            setNewFlowName('');
            setNewFlowParentPath('');
            showFeedback({ tone: 'success', title: 'Flow 创建成功', detail: name });
            await refreshRepoTree();
            await openFlowDocument(path);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '创建 Flow 失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setNewFlowCreating(false);
        }
    }, [groupId, newFlowName, newFlowParentPath, showFeedback, refreshRepoTree]);

    const handleCreateFolder = useCallback(async () => {
        if (!groupId || !newFolderName.trim()) return;
        const name = newFolderName.trim();
        const parentPath = newFolderParentPath ? `${newFolderParentPath}/${name}` : name;
        const folderPath = `_flows/${parentPath}`;
        setNewFolderCreating(true);
        try {
            await createOfflineFolder(groupId, folderPath);
            setNewFolderDialogOpen(false);
            setNewFolderName('');
            setNewFolderParentPath('');
            showFeedback({ tone: 'success', title: '文件夹创建成功', detail: name });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '创建文件夹失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setNewFolderCreating(false);
        }
    }, [groupId, newFolderName, newFolderParentPath, showFeedback, refreshRepoTree]);

    const handleDeleteFlow = useCallback(async () => {
        if (!groupId || !deleteFlowPath) return;
        setDeleteFlowLoading(true);
        try {
            await deleteOfflineFlow(groupId, deleteFlowPath);
            setDeleteFlowDialogOpen(false);
            removeRecoverySnapshot(groupId, deleteFlowPath);
            if (activeFlowPath === deleteFlowPath) {
                setActiveFlowPath(null);
                setDraftSession(null);
            }
            showFeedback({ tone: 'success', title: 'Flow 已删除', detail: deleteFlowName });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '删除 Flow 失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setDeleteFlowLoading(false);
        }
    }, [groupId, deleteFlowPath, deleteFlowName, activeFlowPath, showFeedback, refreshRepoTree]);

    const handleRenameFlow = useCallback(async () => {
        if (!groupId || !renameFlowPath || !renameFlowName.trim()) return;
        const newName = renameFlowName.trim();
        setRenameFlowLoading(true);
        try {
            await renameOfflineFlow(groupId, renameFlowPath, newName);
            setRenameFlowDialogOpen(false);
            const oldPath = renameFlowPath;
            const parts = oldPath.split('/');
            const newPath = parts.length >= 2 ? `_flows/${newName}/flow.yaml` : oldPath;
            if (draftSession?.path === oldPath) {
                leaveCurrentFlowRef.current?.(draftSession);
                setDraftSession(null);
            }
            moveRecoverySnapshot(groupId, oldPath, newPath);
            if (activeFlowPath === oldPath) {
                setActiveFlowPath(newPath);
            }
            showFeedback({ tone: 'success', title: 'Flow 已重命名', detail: `${renameFlowOriginalName} → ${newName}` });
            await refreshRepoTree();
            if (activeFlowPath === newPath || activeFlowPath === oldPath) {
                await openFlowDocumentRef.current(newPath !== oldPath ? newPath : oldPath);
            }
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '重命名 Flow 失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setRenameFlowLoading(false);
        }
    }, [groupId, renameFlowPath, renameFlowName, renameFlowOriginalName, activeFlowPath, draftSession, showFeedback, refreshRepoTree]);

    const handleDeleteFolder = useCallback(async () => {
        if (!groupId || !deleteFolderPath) return;
        setDeleteFolderLoading(true);
        try {
            await deleteOfflineFolder(groupId, deleteFolderPath);
            setDeleteFolderDialogOpen(false);
            removeFolderRecoverySnapshots(groupId, deleteFolderPath);
            const nextState = clearDeletedFolderDraftState({
                activeFlowPath,
                deleteFolderPath,
                draftSession,
                leaveCurrentFlow: (session) => { leaveCurrentFlowRef.current?.(session); },
            });
            setActiveFlowPath(nextState.activeFlowPath);
            setDraftSession(nextState.draftSession);
            showFeedback({ tone: 'success', title: '文件夹已删除', detail: deleteFolderName });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '删除文件夹失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setDeleteFolderLoading(false);
        }
    }, [groupId, deleteFolderPath, deleteFolderName, activeFlowPath, draftSession, showFeedback, refreshRepoTree]);

    const handleRenameFolder = useCallback(async () => {
        if (!groupId || !renameFolderPath || !renameFolderName.trim()) return;
        const newName = renameFolderName.trim();
        setRenameFolderLoading(true);
        try {
            await renameOfflineFolder(groupId, renameFolderPath, newName);
            setRenameFolderDialogOpen(false);

            const oldPath = renameFolderPath;
            const parts = oldPath.split('/');
            parts[parts.length - 1] = newName;
            const newPath = parts.join('/');
            if (draftSession?.path && draftSession.path.startsWith(`${oldPath}/`)) {
                leaveCurrentFlowRef.current?.(draftSession);
                setDraftSession(null);
            }
            moveFolderRecoverySnapshots(groupId, oldPath, newPath);

            if (activeFlowPath && activeFlowPath.startsWith(oldPath + '/')) {
                const refreshedPath = activeFlowPath.replace(oldPath, newPath);
                setActiveFlowPath(refreshedPath);
                await openFlowDocumentRef.current(refreshedPath);
            }

            showFeedback({ tone: 'success', title: '文件夹已重命名', detail: `${renameFolderOriginalName} → ${newName}` });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '重命名文件夹失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setRenameFolderLoading(false);
        }
    }, [groupId, renameFolderPath, renameFolderName, renameFolderOriginalName, activeFlowPath, draftSession, showFeedback, refreshRepoTree]);

    const handleContextMenu = useCallback((event: React.MouseEvent, node: OfflineRepoTreeNode) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
        setContextMenuNode(node);
        setContextMenuOpen(true);
    }, []);

    const openNewFlowDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        // node.path is like "_flows/subdir", strip "_flows/" to get relative path
        const relativePath = node.path.replace(/^_flows\/?/, '');
        setNewFlowParentPath(relativePath);
        setNewFlowName('');
        setNewFlowDialogOpen(true);
    }, []);

    const openNewFolderDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        // node.path is like "_flows/subdir", strip "_flows/" to get relative path for API
        const relativePath = node.path.replace(/^_flows\/?/, '');
        setNewFolderParentPath(relativePath);
        setNewFolderName('');
        setNewFolderDialogOpen(true);
    }, []);

    const openDeleteFlowDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        // node.path is like "_flows/demo/flow.yaml"
        setDeleteFlowPath(node.path);
        // Extract flow name from path: "_flows/demo/flow.yaml" -> "demo"
        const parts = node.path.split('/');
        setDeleteFlowName(parts.length >= 2 ? parts[1] : node.name);
        setDeleteFlowDialogOpen(true);
    }, []);

    const openDeleteFolderDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        setDeleteFolderPath(node.path);
        setDeleteFolderName(node.name);
        setDeleteFolderDialogOpen(true);
    }, []);

    const loadExecutionDetail = useCallback(async (executionId: string, silent = false) => {
        if (!groupId) return;
        if (!silent) setExecutionDetailLoading(true);
        try {
            const detail = await getOfflineExecution(groupId, executionId);
            setActiveExecutionId(executionId);
            setExecutionDetail(detail);
            // 同步更新左侧列表中的状态和时间数据
            setExecutions((current) => current.map((item) => {
                if (item.executionId === executionId) {
                    let durationMs = item.durationMs;
                    if (detail.startDate && detail.endDate) {
                        durationMs = new Date(detail.endDate).getTime() - new Date(detail.startDate).getTime();
                    }
                    return {
                        ...item,
                        status: detail.status,
                        startDate: detail.startDate,
                        endDate: detail.endDate,
                        durationMs: durationMs
                    };
                }
                return item;
            }));
        } catch (error) {
            if (!silent) {
                showFeedback({
                    tone: 'error',
                    title: '执行详情读取失败',
                    detail: getErrorMessage(error, '暂时无法读取执行详情。'),
                });
            }
        } finally {
            if (!silent) setExecutionDetailLoading(false);
        }
    }, [groupId, showFeedback]);

    const openRenameFlowDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        // node.path is like "_flows/demo/flow.yaml"
        setRenameFlowPath(node.path);
        // Extract flow name from path: "_flows/demo/flow.yaml" -> "demo"
        const parts = node.path.split('/');
        const originalName = parts.length >= 2 ? parts[1] : node.name;
        setRenameFlowOriginalName(originalName);
        setRenameFlowName(originalName);
        setRenameFlowDialogOpen(true);
    }, []);

    const openRenameFolderDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        setRenameFolderPath(node.path);
        setRenameFolderOriginalName(node.name);
        setRenameFolderName(node.name);
        setRenameFolderDialogOpen(true);
    }, []);


    const refreshExecutions = useCallback(async (preferExecutionId?: string | null, requestedByOverride?: number | null) => {
        if (!groupId || !activeFlowPath) return;
        setExecutionsLoading(true);
        try {
            const nextExecutions = await listOfflineExecutions(
                groupId,
                activeFlowPath,
                requestedByOverride === undefined ? executionRequestedByFilter : requestedByOverride
            );
            setExecutions(nextExecutions);
            const fallbackId = preferExecutionId && nextExecutions.some((item) => item.executionId === preferExecutionId)
                ? preferExecutionId
                : nextExecutions[0]?.executionId ?? null;
            if (fallbackId) {
                await loadExecutionDetail(fallbackId);
            } else {
                setActiveExecutionId(null);
                setExecutionDetail(null);
            }
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '执行记录读取失败',
                detail: getErrorMessage(error, '暂时无法读取当前 Flow 的执行记录。'),
            });
        } finally {
            setExecutionsLoading(false);
        }
    }, [activeFlowPath, executionRequestedByFilter, groupId, loadExecutionDetail, showFeedback]);

    useEffect(() => {
        if (!executionDialogOpen || !activeFlowPath) return;
        void refreshExecutions(null);
    }, [activeFlowPath, executionDialogOpen, refreshExecutions]);

    // 实时轮询正在运行的执行详情
    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null;
        if (executionDialogOpen && activeExecutionId && executionDetail && isActiveStatus(executionDetail.status)) {
            timer = setInterval(() => {
                void loadExecutionDetail(activeExecutionId, true);
            }, 3000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [executionDialogOpen, activeExecutionId, executionDetail, loadExecutionDetail]);

    // Ctrl/Cmd+N to open new Flow dialog
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
                e.preventDefault();
                if (!newFlowDialogOpen && !nodeEditorOpen && !executionDialogOpen && !scheduleDialogOpen) {
                    setNewFlowParentPath('');
                    setNewFlowName('');
                    setNewFlowDialogOpen(true);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [newFlowDialogOpen, nodeEditorOpen, executionDialogOpen, scheduleDialogOpen]);



    const handleToggleTaskSelection = useCallback((taskId: string) => {
        setDraftSelectedTaskIds((current) => current.includes(taskId)
            ? current.filter((item) => item !== taskId)
            : [...current, taskId]);
    }, [setDraftSelectedTaskIds]);

    const handleReplaceTaskSelection = useCallback((taskIds: string[]) => {
        setDraftSelectedTaskIds(resolveSelectedTaskIds(flowDocument, taskIds));
    }, [flowDocument, setDraftSelectedTaskIds]);

    const handleToggleTreeNode = useCallback((nodeId: string) => {
        setExpandedTreeIds((current) => current.includes(nodeId)
            ? current.filter((item) => item !== nodeId)
            : [...current, nodeId]);
        }, []);

    const handleOpenNodeEditor = useCallback((taskId: string) => {
        const node = flattenDocumentNodes(flowDocument).find((n) => n.taskId === taskId);
        if (!node) return;
        nodeEditorDraftSchedulerRef.current?.cancel();
        setDraftSelectedNodeId(taskId);
        setNodeEditorContent(node.scriptContent);
        pendingNodeEditorDraftRef.current = {
            taskId,
            scriptContent: node.scriptContent,
            ...(node.dataSourceId !== undefined ? { dataSourceId: node.dataSourceId } : {}),
            ...(node.dataSourceType !== undefined ? { dataSourceType: node.dataSourceType } : {}),
        };
        setNodeEditorOpen(true);
    }, [flowDocument, setDraftSelectedNodeId]);

    const buildPendingNodeEditorDraft = useCallback((
        taskId: string,
        scriptContent: string,
        dataSourceId?: number,
        dataSourceType?: string
    ): PendingNodeEditorDraft => ({
        taskId,
        scriptContent,
        ...(dataSourceId !== undefined ? { dataSourceId } : {}),
        ...(dataSourceType !== undefined ? { dataSourceType } : {}),
    }), []);

    const handleNodeEditorOpenChange = useCallback((open: boolean) => {
        setNodeEditorOpen(open);
        if (!open) {
            pendingNodeEditorDraftRef.current = finalizeNodeEditorDraftOnClose({
                pendingDraft: pendingNodeEditorDraftRef.current,
                flushNow: (draft) => nodeEditorDraftSchedulerRef.current?.flushNow(draft),
                cancel: () => nodeEditorDraftSchedulerRef.current?.cancel(),
            });
            const currentNode = flattenDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
            setNodeEditorContent(currentNode?.scriptContent ?? '');
        }
    }, [activeNodeId, flowDocument]);

    const handleNodeEditorTempSave = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
        if (!activeNodeId) return;
        const pendingDraft = buildPendingNodeEditorDraft(activeNodeId, content, dataSourceId, dataSourceType);
        pendingNodeEditorDraftRef.current = pendingDraft;
        nodeEditorDraftSchedulerRef.current?.flushNow(pendingDraft);
        const activeEditingNode = flattenDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
        const validation = validateSqlNodeDataSourceRequirement({
            kind: activeEditingNode?.kind ?? 'SHELL',
            dataSourceId,
            dataSourceType,
            strict: false,
        });
        showFeedback(validation.feedback ?? {
            tone: 'success',
            title: '已更新当前草稿',
            detail: '当前修改仅保留在本机恢复稿中，点击“保存 Flow”后才会写入本地仓库。',
        });
        handleNodeEditorOpenChange(false);
    }, [activeNodeId, buildPendingNodeEditorDraft, flowDocument, handleNodeEditorOpenChange, showFeedback]);

    const handleNodeEditorContentChange = useCallback((content: string) => {
        setNodeEditorContent(content);
        if (!activeNodeId) return;
        const currentPending = pendingNodeEditorDraftRef.current;
        const pendingDraft = buildPendingNodeEditorDraft(
            activeNodeId,
            content,
            currentPending?.dataSourceId,
            currentPending?.dataSourceType,
        );
        pendingNodeEditorDraftRef.current = pendingDraft;
        nodeEditorDraftSchedulerRef.current?.schedule(pendingDraft);
    }, [activeNodeId, buildPendingNodeEditorDraft]);

    const handleNodeEditorDraftChange = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
        setNodeEditorContent(content);
        if (!activeNodeId) return;
        const pendingDraft = buildPendingNodeEditorDraft(activeNodeId, content, dataSourceId, dataSourceType);
        pendingNodeEditorDraftRef.current = pendingDraft;
        nodeEditorDraftSchedulerRef.current?.flushNow(pendingDraft);
    }, [activeNodeId, buildPendingNodeEditorDraft]);

    const handleRenameNode = useCallback((oldId: string, newId: string) => {
        if (!oldId || !newId || !flowDocument) return;
        const cleanNewId = newId.trim();
        if (!cleanNewId) return;

        if (oldId === cleanNewId) return;

        // Check for duplicate ID
        const allNodes = flowDocument.stages.flatMap(s => s.nodes);
        if (allNodes.some(n => n.taskId === cleanNewId)) {
            showFeedback({ tone: 'error', title: '重命名失败', detail: '已存在相同名称的节点。' });
            return;
        }

        // Validate ID format (basic check)
        if (!/^[a-zA-Z0-9_]+$/.test(cleanNewId)) {
            showFeedback({ tone: 'error', title: '重命名失败', detail: '节点名称仅支持字母、数字和下划线。' });
            return;
        }

        setDraftSession(current => {
            if (!current) return current;

            const nextStages = current.workingDraft.stages.map(stage => ({
                ...stage,
                nodes: stage.nodes.map(node => {
                    if (node.taskId === oldId) {
                        let nextScriptPath = node.scriptPath;
                        const oldFileName = `${oldId}.`;
                        const newFileName = `${cleanNewId}.`;
                        if (nextScriptPath.includes(oldFileName)) {
                            nextScriptPath = nextScriptPath.replace(oldFileName, newFileName);
                        }
                        
                        return { ...node, taskId: cleanNewId, scriptPath: nextScriptPath };
                    }
                    return node;
                })
            }));

            const nextEdges = (current.workingDraft.edges || []).map(edge => {
                let changed = false;
                let source = edge.source;
                let target = edge.target;
                if (source === oldId) {
                    source = cleanNewId;
                    changed = true;
                }
                if (target === oldId) {
                    target = cleanNewId;
                    changed = true;
                }
                return changed ? { ...edge, source, target, id: `${source}->${target}` } : edge;
            });

            const nextLayout = { ...(current.workingDraft.layout || {}) };
            if (nextLayout[oldId]) {
                nextLayout[cleanNewId] = nextLayout[oldId];
                delete nextLayout[oldId];
            }

            const nextDocument = {
                ...current.workingDraft,
                stages: nextStages,
                edges: nextEdges,
                layout: nextLayout,
            };
            return replaceFlowDraftWorkingDocument(current, nextDocument);
        });

        if (activeNodeId === oldId) {
            setDraftSelectedNodeId(cleanNewId);
        }
        setDraftSelectedTaskIds(currIds => currIds.map(id => id === oldId ? cleanNewId : id));

    }, [activeNodeId, flowDocument, setDraftSelectedNodeId, setDraftSelectedTaskIds, showFeedback]);

    const handleAddCanvasNode = useCallback((kind: OfflineFlowNodeKind, position: { x: number; y: number }) => {
        if (!flowDocument) return;

        const existingIds = new Set(flattenDocumentNodes(flowDocument).map((n) => n.taskId));
        let index = 1;
        let newTaskId = `${kind.toLowerCase()}_node_${index}`;
        while (existingIds.has(newTaskId)) {
            index++;
            newTaskId = `${kind.toLowerCase()}_node_${index}`;
        }

        const ext = getOfflineNodeScriptExtension(kind);
        const flowDir = flowDocument.path.replace('/flow.yaml', '');
        const scriptPath = `${flowDir.replace(/^_flows\//, 'scripts/')}/${newTaskId}.${ext}`;

        const newNode: OfflineFlowNode = {
            taskId: newTaskId,
            kind,
            scriptPath,
            scriptContent: getOfflineNodeDefaultScript(kind),
        };

        setDraftSession((current) => {
            if (!current) return current;
            const updatedStages = [...current.workingDraft.stages];
            if (updatedStages.length === 0) {
                updatedStages.push({
                    stageId: 'main',
                    parallel: false,
                    nodes: [newNode],
                });
            } else {
                updatedStages[0] = {
                    ...updatedStages[0],
                    nodes: [...updatedStages[0].nodes, newNode],
                };
            }

            return replaceFlowDraftWorkingDocument(current, {
                ...current.workingDraft,
                stages: updatedStages,
                layout: {
                    ...(current.workingDraft.layout || {}),
                    [newTaskId]: position,
                },
            });
        });

        const { nextActiveNodeId, nextSelectedTaskIds } = resolveSelectionStateAfterAddingNode({
            currentSelectedTaskIds: selectedTaskIds,
            newTaskId,
        });
        setDraftSelectedNodeId(nextActiveNodeId);
        setDraftSelectedTaskIds(nextSelectedTaskIds);
    }, [flowDocument, selectedTaskIds, setDraftSelectedNodeId, setDraftSelectedTaskIds]);

    const handleCanvasNodesChange = useCallback((nodes: Node[]) => {
        const previousNodeIds = new Set(canvasNodesRef.current.map((node) => node.id));
        const nextNodeIds = new Set(nodes.map((node) => node.id));
        canvasNodesRef.current = nodes;
        const nodeSetChanged = previousNodeIds.size !== nextNodeIds.size
            || Array.from(previousNodeIds).some((nodeId) => !nextNodeIds.has(nodeId));
        if (!nodeSetChanged) {
            return;
        }

        const pendingDraft = pendingNodeEditorDraftRef.current;
        let nextPendingDraft = pendingDraft;

        setDraftSession((current) => {
            if (!current) {
                nextPendingDraft = null;
                return current;
            }

            const currentWithPending = pendingDraft
                ? flushNodeEditorDraft(current, pendingDraft)
                : current;
            const nextDocument = applyCanvasStateToDocument(currentWithPending.workingDraft, nodes, canvasEdgesRef.current);
            nextPendingDraft = resolvePendingNodeEditorDraftAfterDocumentChange(pendingDraft, nextDocument);
            const nextSelectedNodeId = resolveSelectedNodeId(nextDocument, activeNodeId);
            const nextSelectedTaskIds = resolveSelectedTaskIds(nextDocument, selectedTaskIds);

            return {
                ...replaceFlowDraftWorkingDocument(currentWithPending, nextDocument),
                selectedNodeId: nextSelectedNodeId,
                selectedTaskIds: [...nextSelectedTaskIds],
            };
        });

        pendingNodeEditorDraftRef.current = nextPendingDraft;
        if (!nextPendingDraft) {
            nodeEditorDraftSchedulerRef.current?.cancel();
            if (pendingDraft) {
                setNodeEditorOpen(false);
                setNodeEditorContent('');
            }
        }
    }, [activeNodeId, selectedTaskIds]);

    const handleCanvasEdgesChange = useCallback((edges: Edge[]) => {
        const nextEdges = buildEdgesFromCanvasEdges(edges);
        canvasEdgesRef.current = edges;
        setDraftSession((current) => {
            if (!current) return current;
            if (JSON.stringify(current.workingDraft.edges) === JSON.stringify(nextEdges)) {
                return current;
            }
            return replaceFlowDraftWorkingDocument(current, {
                ...current.workingDraft,
                edges: nextEdges,
            });
        });
    }, []);

    const handleCanvasNodeLayoutCommit = useCallback((nodes: Node[]) => {
        const nextLayout = buildLayoutFromCanvasNodes(nodes);
        canvasNodesRef.current = nodes;
        setDraftSession((current) => {
            if (!current) return current;
            if (JSON.stringify(current.workingDraft.layout) === JSON.stringify(nextLayout)) {
                return current;
            }
            return replaceFlowDraftWorkingDocument(current, {
                ...current.workingDraft,
                layout: nextLayout,
            });
        });
    }, []);

    const validateDocumentForAction = useCallback((nodeOverride?: { taskId: string; content: string; dataSourceId?: number; dataSourceType?: string }) => {
        if (!flowDocument) return true;
        
        const invalidNode = findFirstNodeWithInvalidDataSource(flowDocument, nodeOverride);
        if (invalidNode) {
            const validation = validateSqlNodeDataSourceRequirement({
                kind: invalidNode.kind,
                dataSourceId: invalidNode.dataSourceId,
                dataSourceType: invalidNode.dataSourceType,
                strict: true,
            });
            if (!validation.allowed && validation.feedback) {
                showFeedback({
                    ...validation.feedback,
                    detail: `校验失败。请检查画布上标记为警告的节点（共 ${Object.keys(nodeIssues).length} 个）。`
                });
                return false;
            }
        }
        return true;
    }, [flowDocument, showFeedback]);

    const persistFlowSession = useCallback(async (sessionForSave: FlowDraftSession) => {
        if (!groupId) {
            throw new Error('Missing groupId');
        }
        const draftDocument = sessionForSave.workingDraft;
        return saveOfflineFlowDocument({
            groupId,
            path: sessionForSave.path,
            documentHash: sessionForSave.baseDocument.documentHash,
            documentUpdatedAt: sessionForSave.baseDocument.documentUpdatedAt,
            stages: draftDocument.stages.map((stage) => ({
                stageId: stage.stageId,
                nodes: stage.nodes.map((node) => ({
                    taskId: node.taskId,
                    scriptContent: node.scriptContent,
                    kind: node.kind,
                    scriptPath: node.scriptPath,
                    dataSourceId: node.dataSourceId,
                    dataSourceType: node.dataSourceType,
                })),
            })),
            edges: draftDocument.edges,
            layout: draftDocument.layout,
        });
    }, [groupId]);

    const handleSaveFlow = useCallback(async (nodeOverride?: { taskId: string; content: string; dataSourceId?: number; dataSourceType?: string }) => {
        if (!groupId || !activeFlowPath || !draftSession) return false;
        nodeEditorDraftSchedulerRef.current?.cancel();
        const pendingNodeOverride = pendingNodeEditorDraftRef.current
            ? {
                taskId: pendingNodeEditorDraftRef.current.taskId,
                content: pendingNodeEditorDraftRef.current.scriptContent,
                dataSourceId: pendingNodeEditorDraftRef.current.dataSourceId,
                dataSourceType: pendingNodeEditorDraftRef.current.dataSourceType,
            }
            : undefined;
        const effectiveNodeOverride = nodeOverride ?? pendingNodeOverride;

        if (!validateDocumentForAction(effectiveNodeOverride)) {
            return false;
        }
        const sessionForSave = effectiveNodeOverride
            ? flushNodeEditorDraft(draftSession, {
                taskId: effectiveNodeOverride.taskId,
                scriptContent: effectiveNodeOverride.content,
                dataSourceId: effectiveNodeOverride.dataSourceId,
                dataSourceType: effectiveNodeOverride.dataSourceType,
            })
            : draftSession;
        const draftDocument = sessionForSave.workingDraft;

        const validation = validateSaveFlowDependencies({
            nodeIds: draftDocument.stages.flatMap((s) => s.nodes.map((n) => n.taskId)),
            edges: draftDocument.edges,
        });
        if (!validation.allowed) {
            if (validation.feedback) showFeedback(validation.feedback);
            return false;
        }

        setSavingFlow(true);
        try {
            setDraftSession(sessionForSave);
            pendingNodeEditorDraftRef.current = null;

            const response = await persistFlowSession(sessionForSave);
            const nextSession = rebaseFlowDraftSession(sessionForSave, response);
            setDraftSession(nextSession);
            removeRecoverySnapshot(groupId, sessionForSave.path);
            await refreshRepoStatus();
            showFeedback({
                tone: 'success',
                title: 'Flow 已保存',
                detail: '节点内容、依赖关系和布局已写回本地仓库。',
            });
            return true;
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 409) {
                writeRecoverySnapshot(groupId, sessionForSave.path, buildRecoverySnapshotFromSession(sessionForSave, Date.now()));
                setSaveConflictState({
                    path: sessionForSave.path,
                    pendingSession: sessionForSave,
                });
                return false;
            }
            showFeedback({
                tone: 'error',
                title: '保存失败',
                detail: getErrorMessage(error, '本地脚本文件保存失败，请稍后重试。'),
            });
            return false;
        } finally {
            setSavingFlow(false);
        }
    }, [
        activeFlowPath,
        applyFlowDocumentPayload,
        draftSession,
        groupId,
        persistFlowSession,
        refreshRepoStatus,
        showFeedback,
        validateDocumentForAction,
    ]);

    const handleConfirmLeave = useCallback(async (action: 'save' | 'discard') => {
        if (!pendingNavigation) return;

        if (action === 'save') {
            const saved = await handleSaveFlow();
            if (!saved) return;
        } else {
            if (draftSession) {
                leaveCurrentFlow(draftSession);
            }
        }

        const target = pendingNavigation;
        setPendingNavigation(null);

        if (target.type === 'router') {
            target.blocker.proceed();
        } else if (target.type === 'flow' && target.flowPath) {
            void openFlowDocument(target.flowPath, { force: true });
        }
    }, [pendingNavigation, handleSaveFlow, draftSession, leaveCurrentFlow, openFlowDocument]);

    const handleCancelLeave = useCallback(() => {
        if (!pendingNavigation) return;
        if (pendingNavigation.type === 'router') {
            pendingNavigation.blocker.reset();
        }
        setPendingNavigation(null);
    }, [pendingNavigation]);

    const handleOpenCommitDialog = useCallback(async () => {
        if (!groupId || !activeFlowPath || !flowDocument) return;

        // Auto-save logic if there are unsaved changes
        if (isDirty) {
            if (!validateDocumentForAction()) {
                return;
            }
            // Silent block while saving
            setSavingFlow(true);
            try {
                const saved = await handleSaveFlow();
                if (!saved) {
                    return;
                }
                // After successful save, refresh repo status to ensure 'dirty' flag is picked up by backend if needed
                await refreshRepoStatus();
            } catch {
                // handleSaveFlow already shows error feedback
                return;
            } finally {
                setSavingFlow(false);
            }
        } else {
            // Even if not dirty, still run validation to be safe (e.g. content was saved but invalid state existed)
            if (!validateDocumentForAction()) {
                return;
            }
        }
        
        setCommitDialogOpen(true);
    }, [activeFlowPath, flowDocument, groupId, handleSaveFlow, isDirty, refreshRepoStatus, validateDocumentForAction]);

    const handleExecute = useCallback(async () => {
        if (!groupId || !activeFlowPath || !flowDocument) return;
        if (nodeEditorOpen) {
            showFeedback({
                tone: 'error',
                title: '请先处理当前节点编辑',
                detail: '请先点击应用暂存或关闭节点编辑器，再执行当前 Flow。',
            });
            return;
        }
        if (selectedTaskIds.length === 0) {
            showFeedback({
                tone: 'error',
                title: '请选择要执行的节点',
                detail: '请在画布上勾选需要参与调试的节点。',
            });
            return;
        }

        try {
            const response = await createOfflineDocumentDebugExecution(buildDraftExecutionRequest({
                groupId,
                flowPath: activeFlowPath,
                flowDocument,
                canvasNodes: canvasNodesRef.current,
                canvasEdges: canvasEdgesRef.current,
                selectedTaskIds,
            }));
            showFeedback({
                tone: 'success',
                title: '调试执行已提交',
                detail: `执行 ID：${response.executionId}`,
            });
            setExecutionDialogOpen(true);
            await refreshExecutions(response.executionId);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '调试执行失败',
                detail: getErrorMessage(error, '暂时无法触发调试执行。'),
            });
        }
    }, [activeFlowPath, flowDocument, groupId, nodeEditorOpen, refreshExecutions, selectedTaskIds, showFeedback]);

    const handleStopExecution = useCallback(async (executionId: string) => {
        if (!groupId || !activeFlowPath) return;
        setExecutionActionPending(executionId);
        try {
            await stopOfflineExecution(groupId, executionId);
            showFeedback({
                tone: 'info',
                title: '已请求停止执行',
                detail: `执行 ${executionId} 正在等待 Kestra 收敛状态。`,
            });
            await refreshExecutions(executionId);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '停止执行失败',
                detail: getErrorMessage(error, '暂时无法停止当前执行。'),
            });
        } finally {
            setExecutionActionPending(null);
        }
    }, [activeFlowPath, groupId, refreshExecutions, showFeedback]);

    const handleStopAllExecutions = useCallback(async () => {
        if (!groupId || !activeFlowPath) return;
        setExecutionActionPending('ALL');
        try {
            const stoppedCount = await stopAllOfflineExecutions(groupId, activeFlowPath);
            showFeedback({
                tone: 'info',
                title: '已发送批量停止请求',
                detail: stoppedCount > 0 ? `共请求停止 ${stoppedCount} 条执行。` : '当前没有运行中的执行。',
            });
            await refreshExecutions(activeExecutionId);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '停止全部执行失败',
                detail: getErrorMessage(error, '暂时无法停止当前 Flow 的执行。'),
            });
        } finally {
            setExecutionActionPending(null);
        }
    }, [activeExecutionId, activeFlowPath, groupId, refreshExecutions, showFeedback]);

    const handleScheduleSave = useCallback(async () => {
        if (!groupId || !activeFlowPath) return;
        setScheduleSaving(true);
        try {
            const scheduleBase: { contentHash: string; fileUpdatedAt: number } =
                schedule ?? await getOfflineFlowContent(groupId, activeFlowPath);
            await updateOfflineSchedule({
                groupId,
                path: activeFlowPath,
                cron: scheduleCron,
                timezone: scheduleTimezone,
                contentHash: scheduleBase.contentHash,
                fileUpdatedAt: scheduleBase.fileUpdatedAt,
            });
            await openFlowDocument(activeFlowPath);
            showFeedback({
                tone: 'success',
                title: '调度已更新',
                detail: 'Schedule trigger 已写回本地 Flow 文件。',
            });
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '调度更新失败',
                detail: getErrorMessage(error, '暂时无法更新当前 Flow 的调度配置。'),
            });
        } finally {
            setScheduleSaving(false);
        }
    }, [activeFlowPath, groupId, openFlowDocument, schedule, scheduleCron, scheduleTimezone, showFeedback]);

    const handleScheduleToggle = useCallback(async (enabled: boolean) => {
        if (!groupId || !activeFlowPath || !schedule) return;
        setScheduleSaving(true);
        try {
            await updateOfflineScheduleStatus({
                groupId,
                path: activeFlowPath,
                enabled,
                contentHash: schedule.contentHash,
                fileUpdatedAt: schedule.fileUpdatedAt,
            });
            await openFlowDocument(activeFlowPath);
            showFeedback({
                tone: 'success',
                title: enabled ? '调度已启用' : '调度已停用',
                detail: '最新调度状态已写回本地 Flow 文件。',
            });
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '调度状态更新失败',
                detail: getErrorMessage(error, '暂时无法切换当前 Flow 的调度状态。'),
            });
        } finally {
            setScheduleSaving(false);
        }
    }, [activeFlowPath, groupId, openFlowDocument, schedule, showFeedback]);

    const handleRestoreStaleDraft = useCallback(() => {
        if (!staleDraft) return;
        setDraftSession((current) => current ? resolveDraftConflict(current, 'restore-local') : current);
        showFeedback({
            tone: 'info',
            title: '已恢复旧草稿',
            detail: '你当前看到的是本地草稿内容；保存时会覆盖当前仓库版本的脚本内容。',
        });
    }, [showFeedback, staleDraft]);

    const handleDiscardStaleDraft = useCallback(() => {
        if (!groupId || !activeFlowPath) return;
        removeRecoverySnapshot(groupId, activeFlowPath);
        setDraftSession((current) => current ? resolveDraftConflict(current, 'load-server') : current);
        showFeedback({
            tone: 'info',
            title: '已丢弃本地草稿',
            detail: '工作台将继续使用当前本地文件版本。',
        });
    }, [activeFlowPath, groupId, showFeedback]);

    const handleCloseSaveConflict = useCallback(() => {
        if (saveConflictPending) return;
        setSaveConflictState(null);
    }, [saveConflictPending]);

    const handleDiscardSaveConflict = useCallback(async () => {
        if (!groupId || !saveConflictState) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setSaveConflictPending(true);
        try {
            const reloaded = await openFlowDocument(saveConflictState.path, { preferRecoverySnapshot: false });
            if (!isCurrentGroupAction()) return;
            if (!reloaded) return;
            removeRecoverySnapshot(groupId, saveConflictState.path);
            setSaveConflictState(null);
        } finally {
            if (isCurrentGroupAction()) {
                setSaveConflictPending(false);
            }
        }
    }, [captureGroupActionGuard, groupId, openFlowDocument, saveConflictState]);

    const handleOverwriteSaveConflict = useCallback(async () => {
        if (!groupId || !saveConflictState) return;
        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setSaveConflictPending(true);
        try {
            const latest = await getOfflineFlowDocument(groupId, saveConflictState.path);
            if (!isCurrentGroupAction()) return;
            const rebasedSession = forceOverwriteRebase(saveConflictState.pendingSession, latest);
            writeRecoverySnapshot(groupId, rebasedSession.path, buildRecoverySnapshotFromSession(rebasedSession, Date.now()));
            setSaveConflictState({
                path: rebasedSession.path,
                pendingSession: rebasedSession,
            });
            setDraftSession(rebasedSession);
            const response = await persistFlowSession(rebasedSession);
            if (!isCurrentGroupAction()) return;
            setDraftSession(rebaseFlowDraftSession(rebasedSession, response));
            removeRecoverySnapshot(groupId, rebasedSession.path);
            setSaveConflictState(null);
            await refreshRepoStatus();
            if (!isCurrentGroupAction()) return;
            showFeedback({
                tone: 'success',
                title: 'Flow 已保存',
                detail: '节点内容、依赖关系和布局已写回本地仓库。',
            });
        } catch (error) {
            if (!isCurrentGroupAction()) return;
            const detail = error instanceof AxiosError && error.response?.status === 409
                ? '服务器版本再次发生变化，请确认后重试覆盖保存。'
                : getErrorMessage(error, '暂时无法基于最新版本覆盖保存，请稍后重试。');
            showFeedback({
                tone: 'error',
                title: '覆盖保存失败',
                detail,
            });
        } finally {
            if (isCurrentGroupAction()) {
                setSaveConflictPending(false);
            }
        }
    }, [captureGroupActionGuard, groupId, persistFlowSession, refreshRepoStatus, saveConflictState, showFeedback]);

    return (
        <section className="offline-page">
            <div className={`offline-workbench-shell${activeFlowPath && flowDocument ? ' has-inspector' : ''}`}>
                <aside className="offline-rail animate-enter">
                    <div className="offline-rail-toolbar">
                        <span className="offline-branch-badge">{branchLabel}</span>
                        {canWrite && (
                            <TooltipProvider delayDuration={400}>
                                <div className="offline-rail-toolbar-actions">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="offline-rail-toolbar-btn"
                                            aria-label="新建"
                                            onClick={() => setNewItemMenuOpen(!newItemMenuOpen)}
                                            disabled={!groupId || repoLoading || treeLoading || flowLoading}
                                        >
                                            <Plus size={14} />
                                            {newItemMenuOpen && (
                                                <div
                                                    className="offline-new-item-menu"
                                                    onMouseLeave={() => setNewItemMenuOpen(false)}
                                                >
                                                    <button
                                                        type="button"
                                                        className="offline-new-item-menu-item"
                                                        onClick={() => { setNewItemMenuOpen(false); setNewFlowDialogOpen(true); }}
                                                    >
                                                        <FileCode2 size={13} />
                                                        新建 Flow
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="offline-new-item-menu-item"
                                                        onClick={() => { setNewItemMenuOpen(false); setNewFolderParentPath(''); setNewFolderName(''); setNewFolderDialogOpen(true); }}
                                                    >
                                                        <FolderPlus size={13} />
                                                        新建文件夹
                                                    </button>
                                                </div>
                                            )}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        新建
                                    </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="offline-rail-toolbar-btn"
                                            aria-label="刷新"
                                            onClick={() => void refreshWorkspace()}
                                            disabled={!groupId || repoLoading || treeLoading || flowLoading}
                                        >
                                            {repoLoading || treeLoading ? <LoaderCircle size={14} className="offline-spin" /> : <RefreshCcw size={14} />}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        刷新
                                    </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="offline-rail-toolbar-btn"
                                            aria-label="推送"
                                            onClick={() => void handlePush()}
                                            disabled={!groupId || pushLoading || repoLoading || treeLoading}
                                        >
                                            {pushLoading ? <LoaderCircle size={14} className="offline-spin" /> : <GitPushIcon dirty={!isDirty && !repoStatus?.dirty && !!repoStatus?.ahead} />}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        推送
                                    </TooltipContent>
                                </Tooltip>
                                </div>
                            </TooltipProvider>
                        )}
                    </div>

                    <section className="offline-rail-panel offline-rail-panel-grow">
                        {treeLoading ? (
                            <div className="offline-rail-empty">正在加载项目树…</div>
                        ) : !repoTree?.root.children.length ? (
                            <div className="offline-rail-empty">
                                {repoTree ? '当前仓库还没有可打开的 Flow。\n点击上方"新建"创建第一个 Flow。' : '当前仓库还没有可打开的 Flow。'}
                            </div>
                        ) : (
                            <div className="offline-tree-shell">
                                <div className="offline-tree-root">
                                    <button
                                        type="button"
                                        className={`offline-tree-root-label${expandedTreeIds.length === 0 ? ' is-collapsed' : ''}`}
                                        onClick={() => {
                                            const allIds = [repoTree.root.id, ...collectTreeDirectoryIds(repoTree.root)];
                                            if (expandedTreeIds.length > 0) {
                                                setExpandedTreeIds([]);
                                            } else {
                                                setExpandedTreeIds(allIds);
                                            }
                                        }}
                                        onContextMenu={(e) => handleContextMenu(e, repoTree.root)}
                                    >
                                        <span className={`offline-tree-row-caret${expandedTreeIds.length > 0 ? ' is-expanded' : ''}`}>
                                            <ChevronRight size={14} />
                                        </span>
                                        <span className="offline-tree-row-icon">
                                            <FolderOpen size={15} />
                                        </span>
                                        <span>{repoTree.root.name}</span>
                                    </button>
                                    {expandedTreeIds.length > 0 && (
                                        <div className="offline-tree-children">
                                            {repoTree.root.children.map((child) => (
                                                <RepoTreeBranch
                                                    key={child.id}
                                                    node={child}
                                                    depth={1}
                                                    activeFlowPath={activeFlowPath}
                                                    expandedIds={expandedTreeIds}
                                                    onToggle={handleToggleTreeNode}
                                                    onOpenFlow={(path) => void openFlowDocument(path)}
                                                    onContextMenu={handleContextMenu}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </section>
                </aside>

                <main className="offline-main-panel animate-enter animate-enter-delay-1">
                    {!activeFlowPath || !flowDocument ? (
                        <div className="offline-empty-state">
                            <p>从左侧项目树选择一个 Flow</p>
                        </div>
                    ) : (
                        <>
                            <header className="offline-canvas-toolbar">
                                <label className="offline-canvas-toolbar-selectall">
                                    <input
                                        type="checkbox"
                                        checked={nodeCount > 0 && selectedTaskIds.length === nodeCount}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setDraftSelectedTaskIds(flattenDocumentNodes(flowDocument).map((n) => n.taskId));
                                            } else {
                                                setDraftSelectedTaskIds([]);
                                            }
                                        }}
                                        disabled={nodeCount === 0}
                                    />
                                    全选
                                </label>

                                <TooltipProvider delayDuration={400}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={!activeFlowPath || !canWrite || !isDirty || savingFlow}
                                                onClick={() => void handleSaveFlow()}
                                                aria-label="保存"
                                            >
                                            <span className="relative flex">
                                                {savingFlow ? <LoaderCircle size={16} className="offline-spin" /> : <Save size={16} />}
                                                {isDirty && <span className="offline-toolbar-dot" />}
                                            </span>
                                        </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            保存
                                        </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={!activeFlowPath || !canWrite || committing}
                                                onClick={handleOpenCommitDialog}
                                                aria-label="提交"
                                            >
                                                <span className="relative flex">
                                                    <GitCommitHorizontal size={16} />
                                                    {!isDirty && !!repoStatus?.dirty && <span className="offline-toolbar-dot" />}
                                                </span>
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            提交
                                        </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={!activeFlowPath || !canWrite || isDirty}
                                                onClick={() => setScheduleDialogOpen(true)}
                                                aria-label="调度"
                                            >
                                                <Settings2 size={16} />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            调度
                                        </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={isExecuteButtonDisabled({ activeFlowPath, canWrite })}
                                                onClick={() => void handleExecute()}
                                                aria-label="执行"
                                            >
                                                <Play size={16} />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            执行
                                        </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={!activeFlowPath}
                                                onClick={() => setExecutionDialogOpen(true)}
                                                aria-label="执行结果"
                                            >
                                                <History size={16} />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            执行结果
                                        </TooltipContent>
                                    </Tooltip>

                                    <span className="offline-toolbar-divider" />

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={!activeFlowPath || !canWrite}
                                                onClick={() => {
                                                    if (!flowDocument) return;
                                                    const board = canvasBoardRef.current;
                                                    const center = board
                                                        ? { x: board.getBoundingClientRect().width / 2, y: board.getBoundingClientRect().height / 2 }
                                                        : { x: 300, y: 200 };
                                                    handleAddCanvasNode('SQL', center);
                                                }}
                                                aria-label="添加 SQL 节点"
                                            >
                                                <FileCode2 size={16} />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            添加 SQL 节点
                                        </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={!activeFlowPath || !canWrite}
                                                onClick={() => {
                                                    if (!flowDocument) return;
                                                    const board = canvasBoardRef.current;
                                                    const center = board
                                                        ? { x: board.getBoundingClientRect().width / 2, y: board.getBoundingClientRect().height / 2 }
                                                        : { x: 300, y: 200 };
                                                    handleAddCanvasNode('HIVE_SQL', center);
                                                }}
                                                aria-label="添加 HiveSQL 节点"
                                            >
                                                <Database size={16} />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            添加 HiveSQL 节点
                                        </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-canvas-toolbar-btn"
                                                disabled={!activeFlowPath || !canWrite}
                                                onClick={() => {
                                                    if (!flowDocument) return;
                                                    const board = canvasBoardRef.current;
                                                    const center = board
                                                        ? { x: board.getBoundingClientRect().width / 2, y: board.getBoundingClientRect().height / 2 }
                                                        : { x: 300, y: 200 };
                                                    handleAddCanvasNode('SHELL', center);
                                                }}
                                                aria-label="添加 Shell 节点"
                                            >
                                                <TerminalSquare size={16} />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            添加 Shell 节点
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </header>

                            {staleDraft ? (
                                <section className="offline-conflict-banner">
                                    <div className="offline-conflict-copy">
                                        <AlertTriangle size={16} />
                                        <div>
                                            <strong>发现未保存的本地恢复稿</strong>
                                            <p>当前文件也有更新。你可以继续恢复稿，或加载仓库最新内容。</p>
                                        </div>
                                    </div>
                                    <div className="offline-conflict-actions">
                                        <Button type="button" variant="outline" size="sm" onClick={handleDiscardStaleDraft}>
                                            加载最新内容
                                        </Button>
                                        <Button type="button" size="sm" onClick={handleRestoreStaleDraft}>
                                            继续恢复稿
                                        </Button>
                                    </div>
                                </section>
                            ) : null}

                            <section className="offline-canvas-board" ref={canvasBoardRef}>
                                <ReactFlowProvider key={activeFlowPath}>
                                    <FlowCanvas
                                        flowDocument={flowDocument}
                                        selectedTaskIds={selectedTaskIds}
                                        activeNodeId={activeNodeId}
                                        nodeIssues={nodeIssues}
                                        nodeStatuses={nodeStatuses}
                                        onNodesChange={handleCanvasNodesChange}
                                        onEdgesChange={handleCanvasEdgesChange}
                                        onNodeLayoutCommit={handleCanvasNodeLayoutCommit}
                                        onSelectNode={setDraftSelectedNodeId}
                                        onToggleTaskSelection={handleToggleTaskSelection}
                                        onReplaceTaskSelection={handleReplaceTaskSelection}
                                        onDoubleClickNode={handleOpenNodeEditor}
                                        onAddNode={handleAddCanvasNode}
                                        onRenameNode={handleRenameNode}
                                    />
                                </ReactFlowProvider>
                            </section>
                        </>
                    )}
                </main>
            </div>

            <SaveConflictDialog
                open={saveConflictState !== null}
                pending={saveConflictPending}
                onOpenChange={(open) => {
                    if (!open) handleCloseSaveConflict();
                }}
                onOverwrite={() => void handleOverwriteSaveConflict()}
                onDiscardAndReload={() => void handleDiscardSaveConflict()}
            />

            <ExecutionDialog
                open={executionDialogOpen}
                flowPath={activeFlowPath}
                executions={executions}
                loading={executionsLoading}
                detail={executionDetail}
                detailLoading={executionDetailLoading}
                activeExecutionId={activeExecutionId}
                actionPending={executionActionPending}
                requestedByFilter={executionRequestedByFilter}
                currentUserId={currentUser?.id ?? null}
                onOpenChange={(open) => setExecutionDialogOpen(open)}
                onRefresh={() => void refreshExecutions(activeExecutionId)}
                onSelectExecution={(executionId) => void loadExecutionDetail(executionId)}
                onStopExecution={(executionId) => void handleStopExecution(executionId)}
                onOpenExecutionPage={(executionId) => navigate(`/offline/executions/${encodeURIComponent(executionId)}`)}
                onStopAll={() => void handleStopAllExecutions()}
                onOpenTaskLogs={(executionId, taskId) => navigate(`/offline/executions/${encodeURIComponent(executionId)}?taskId=${encodeURIComponent(taskId)}`)}
                onRequestedByFilterChange={(requestedBy) => {
                    setExecutionRequestedByFilter(requestedBy);
                    void refreshExecutions(activeExecutionId, requestedBy);
                }}
            />

            <ScheduleDialog
                open={scheduleDialogOpen}
                schedule={schedule}
                cron={scheduleCron}
                timezone={scheduleTimezone}
                loading={scheduleLoading}
                saving={scheduleSaving}
                path={activeFlowPath}
                onOpenChange={(open) => {
                    setScheduleDialogOpen(open);
                    if (open && activeFlowPath) {
                        void loadScheduleSnapshot(activeFlowPath);
                    }
                }}
                onCronChange={setScheduleCron}
                onTimezoneChange={setScheduleTimezone}
                onSave={() => void handleScheduleSave()}
                onToggle={(enabled) => void handleScheduleToggle(enabled)}
            />

            <Dialog open={commitDialogOpen} onOpenChange={(open) => {
                setCommitDialogOpen(open);
                if (!open) { setCommitMessage(''); }
            }}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card" style={{ width: 'min(460px, 90vw)' }}>
                            <div className="offline-dialog-header">
                                <div>
                                    <DialogTitle className="offline-dialog-title">版本提交 (Commit)</DialogTitle>
                                    <DialogDescription className="offline-dialog-description">
                                        将当前修改的内容标记为一个版本
                                    </DialogDescription>
                                </div>
                                <button
                                    className="offline-dialog-close"
                                    type="button"
                                    onClick={() => { setCommitDialogOpen(false); setCommitMessage(''); }}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="offline-dialog-body" style={{ marginBottom: 16 }}>
                                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                                    提交说明
                                </label>
                                <Input
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    placeholder="例如：Update query conditions"
                                    autoFocus
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div className="offline-dialog-actions">
                                <div />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { setCommitDialogOpen(false); setCommitMessage(''); }}
                                        disabled={committing}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="default"
                                        size="sm"
                                        onClick={() => void handleCommit()}
                                        disabled={!commitMessage.trim() || committing}
                                    >
                                        {committing ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        {committing ? '提交中…' : '提交'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            <NodeEditorDialog
                open={nodeEditorOpen}
                activeNode={activeNode}
                groupId={groupId}
                content={nodeEditorContent}
                onOpenChange={handleNodeEditorOpenChange}
                onTempSave={handleNodeEditorTempSave}
                onContentChange={handleNodeEditorContentChange}
                onDraftChange={handleNodeEditorDraftChange}
            />

            <Dialog open={newFlowDialogOpen} onOpenChange={(open) => {
                setNewFlowDialogOpen(open);
                if (!open) { setNewFlowName(''); setNewFlowParentPath(''); }
            }}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card" style={{ width: 'min(520px, 90vw)' }}>
                            <div className="offline-dialog-header">
                                <div>
                                    <DialogTitle className="offline-dialog-title">新建 Flow</DialogTitle>
                                    <DialogDescription className="offline-dialog-description">
                                        输入 Flow 名称，将自动创建空白的 Flow 文件
                                    </DialogDescription>
                                </div>
                                <button
                                    className="offline-dialog-close"
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => { setNewFlowDialogOpen(false); setNewFlowName(''); setNewFlowParentPath(''); }}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="offline-dialog-body">
                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                                        Flow 名称
                                    </label>
                                    <Input
                                        value={newFlowName}
                                        onChange={(e) => setNewFlowName(e.target.value)}
                                        placeholder="例如：data_pipeline"
                                        autoFocus
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                                        存储路径 {newFlowParentPath ? `（已选：${newFlowParentPath.replace('_flows/', '')}）` : `（默认：${repoTree?.root.name ?? '根目录'}）`}
                                    </label>
                                    {repoTree ? (
                                        <PathPicker
                                            rootNode={repoTree.root}
                                            selectedPath={newFlowParentPath}
                                            onSelect={setNewFlowParentPath}
                                        />
                                    ) : (
                                        <div style={{ padding: '12px 12px', color: 'var(--color-text-secondary)', fontSize: '0.84rem' }}>
                                            加载目录树中...
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="offline-dialog-actions">
                                <div />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { setNewFlowDialogOpen(false); setNewFlowName(''); setNewFlowParentPath(''); }}
                                        disabled={newFlowCreating}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="default"
                                        size="sm"
                                        onClick={() => void handleCreateFlow()}
                                        disabled={!newFlowName.trim() || newFlowCreating}
                                    >
                                        {newFlowCreating ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        {newFlowCreating ? '创建中…' : '创建'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            {/* 新建文件夹 Dialog */}
            <Dialog open={newFolderDialogOpen} onOpenChange={(open) => {
                setNewFolderDialogOpen(open);
                if (!open) {
                    setNewFolderName('');
                    setNewFolderParentPath('');
                }
            }}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card" style={{ width: 'min(460px, 90vw)' }}>
                            <div className="offline-dialog-header">
                                <div>
                                    <DialogTitle className="offline-dialog-title">新建文件夹</DialogTitle>
                                    <DialogDescription className="offline-dialog-description">
                                        输入文件夹名称，将在指定路径下创建文件夹
                                    </DialogDescription>
                                </div>
                                <button
                                    className="offline-dialog-close"
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => { setNewFolderDialogOpen(false); setNewFolderName(''); setNewFolderParentPath(''); }}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="offline-dialog-body">
                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                                        文件夹名称
                                    </label>
                                    <Input
                                        value={newFolderName}
                                        onChange={(e) => setNewFolderName(e.target.value)}
                                        placeholder="例如：data_pipeline"
                                        autoFocus
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                                        存储路径 {newFolderParentPath ? `（已选：${newFolderParentPath.replace('_flows/', '')}）` : `（默认：${repoTree?.root.name ?? '根目录'}）`}
                                    </label>
                                    {repoTree ? (
                                        <PathPicker
                                            rootNode={repoTree.root}
                                            selectedPath={newFolderParentPath}
                                            onSelect={setNewFolderParentPath}
                                        />
                                    ) : (
                                        <div style={{ padding: '12px 12px', color: 'var(--color-text-secondary)', fontSize: '0.84rem' }}>
                                            加载目录树中...
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="offline-dialog-actions">
                                <div />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { setNewFolderDialogOpen(false); setNewFolderName(''); setNewFolderParentPath(''); }}
                                        disabled={newFolderCreating}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="default"
                                        size="sm"
                                        onClick={() => void handleCreateFolder()}
                                        disabled={!newFolderName.trim() || newFolderCreating}
                                    >
                                        {newFolderCreating ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        {newFolderCreating ? '创建中…' : '创建'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            {/* 删除 Flow 确认对话框 */}
            <Dialog open={deleteFlowDialogOpen} onOpenChange={setDeleteFlowDialogOpen}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card" style={{ width: 'min(420px, 90vw)' }}>
                            <div className="offline-dialog-header">
                                <div>
                                    <DialogTitle className="offline-dialog-title">确认删除 Flow</DialogTitle>
                                    <DialogDescription className="offline-dialog-description">
                                        确定要删除 Flow「{deleteFlowName}」吗？此操作不可恢复。
                                    </DialogDescription>
                                </div>
                                <button
                                    className="offline-dialog-close"
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => setDeleteFlowDialogOpen(false)}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="offline-dialog-actions">
                                <div />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setDeleteFlowDialogOpen(false)}
                                        disabled={deleteFlowLoading}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => void handleDeleteFlow()}
                                        disabled={deleteFlowLoading}
                                    >
                                        {deleteFlowLoading ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        {deleteFlowLoading ? '删除中…' : '删除'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            {/* 删除文件夹确认对话框 */}
            <Dialog open={deleteFolderDialogOpen} onOpenChange={setDeleteFolderDialogOpen}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card" style={{ width: 'min(420px, 90vw)' }}>
                            <div className="offline-dialog-header">
                                <div>
                                    <DialogTitle className="offline-dialog-title">确认删除文件夹</DialogTitle>
                                    <DialogDescription className="offline-dialog-description">
                                        确定要删除文件夹「{deleteFolderName}」吗？其下所有内容都将被物理删除，此操作不可恢复。
                                    </DialogDescription>
                                </div>
                                <button
                                    className="offline-dialog-close"
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => setDeleteFolderDialogOpen(false)}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="offline-dialog-actions">
                                <div />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setDeleteFolderDialogOpen(false)}
                                        disabled={deleteFolderLoading}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => void handleDeleteFolder()}
                                        disabled={deleteFolderLoading}
                                    >
                                        {deleteFolderLoading ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        {deleteFolderLoading ? '删除中…' : '删除'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            {/* 重命名文件夹对话框 */}
            <Dialog open={renameFolderDialogOpen} onOpenChange={setRenameFolderDialogOpen}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card" style={{ width: 'min(420px, 90vw)' }}>
                            <div className="offline-dialog-header">
                                <div>
                                    <DialogTitle className="offline-dialog-title">重命名文件夹</DialogTitle>
                                    <DialogDescription className="offline-dialog-description">
                                        将文件夹「{renameFolderOriginalName}」重命名为：
                                    </DialogDescription>
                                </div>
                                <button
                                    className="offline-dialog-close"
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => setRenameFolderDialogOpen(false)}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="offline-dialog-body" style={{ marginTop: 12 }}>
                                <Input
                                    value={renameFolderName}
                                    onChange={(e) => setRenameFolderName(e.target.value)}
                                    placeholder="输入新名称"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && renameFolderName.trim()) {
                                            void handleRenameFolder();
                                        }
                                    }}
                                />
                            </div>
                            <div className="offline-dialog-actions">
                                <div />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setRenameFolderDialogOpen(false)}
                                        disabled={renameFolderLoading}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="default"
                                        size="sm"
                                        onClick={() => void handleRenameFolder()}
                                        disabled={!renameFolderName.trim() || renameFolderLoading}
                                    >
                                        {renameFolderLoading ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        {renameFolderLoading ? '重命名中…' : '重命名'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            {/* 重命名 Flow 对话框 */}
            <Dialog open={renameFlowDialogOpen} onOpenChange={setRenameFlowDialogOpen}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card" style={{ width: 'min(420px, 90vw)' }}>
                            <div className="offline-dialog-header">
                                <div>
                                    <DialogTitle className="offline-dialog-title">重命名 Flow</DialogTitle>
                                    <DialogDescription className="offline-dialog-description">
                                        将「{renameFlowOriginalName}」重命名为：
                                    </DialogDescription>
                                </div>
                                <button
                                    className="offline-dialog-close"
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => setRenameFlowDialogOpen(false)}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="offline-dialog-body" style={{ marginTop: 12 }}>
                                <Input
                                    value={renameFlowName}
                                    onChange={(e) => setRenameFlowName(e.target.value)}
                                    placeholder="输入新名称"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && renameFlowName.trim()) {
                                            void handleRenameFlow();
                                        }
                                    }}
                                />
                            </div>
                            <div className="offline-dialog-actions">
                                <div />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setRenameFlowDialogOpen(false)}
                                        disabled={renameFlowLoading}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="default"
                                        size="sm"
                                        onClick={() => void handleRenameFlow()}
                                        disabled={!renameFlowName.trim() || renameFlowLoading}
                                    >
                                        {renameFlowLoading ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        {renameFlowLoading ? '重命名中…' : '重命名'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            {/* 右键菜单 */}
            {contextMenuOpen && contextMenuPosition && (
                <div
                    className="offline-context-menu"
                    style={{
                        position: 'fixed',
                        left: contextMenuPosition.x,
                        top: contextMenuPosition.y,
                        zIndex: 9999,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {(contextMenuNode?.kind === 'DIRECTORY' || contextMenuNode?.kind === 'ROOT') && canWrite && (
                        <>
                            <button
                                type="button"
                                className="offline-context-menu-item"
                                onClick={() => openNewFlowDialogFromContext(contextMenuNode!)}
                            >
                                <FileCode2 size={13} />
                                新建 Flow
                            </button>
                            <button
                                type="button"
                                className="offline-context-menu-item"
                                onClick={() => openNewFolderDialogFromContext(contextMenuNode!)}
                            >
                                <FolderPlus size={13} />
                                新建文件夹
                            </button>
                            {contextMenuNode?.kind === 'DIRECTORY' && (
                                <>
                                    <div className="offline-context-menu-separator" />
                                    <button
                                        type="button"
                                        className="offline-context-menu-item"
                                        onClick={() => openRenameFolderDialogFromContext(contextMenuNode!)}
                                    >
                                        <Pencil size={13} />
                                        重命名
                                    </button>
                                    <button
                                        type="button"
                                        className="offline-context-menu-item danger"
                                        onClick={() => openDeleteFolderDialogFromContext(contextMenuNode!)}
                                    >
                                        <Trash2 size={13} />
                                        删除
                                    </button>
                                </>
                            )}
                        </>
                    )}
                    {contextMenuNode?.kind === 'FLOW' && canWrite && (
                        <>
                            <button
                                type="button"
                                className="offline-context-menu-item"
                                onClick={() => openRenameFlowDialogFromContext(contextMenuNode!)}
                            >
                                <Pencil size={13} />
                                重命名
                            </button>
                            <button
                                type="button"
                                className="offline-context-menu-item danger"
                                onClick={() => openDeleteFlowDialogFromContext(contextMenuNode!)}
                            >
                                <Trash2 size={13} />
                                删除
                            </button>
                        </>
                    )}
                </div>
            )}

            <Dialog open={pendingNavigation !== null} onOpenChange={(open) => { if (!open) handleCancelLeave(); }}>
                <DialogPortal>
                    <DialogOverlay className="offline-dialog-backdrop" />
                    <DialogContent className="offline-dialog-positioner">
                        <div className="offline-dialog-card is-warning" style={{ width: '400px' }}>
                            <div className="offline-dialog-header">
                                <div className="flex items-center gap-3">
                                    <div className="offline-dialog-icon-wrap is-warning">
                                        <AlertTriangle size={20} />
                                    </div>
                                    <div>
                                        <DialogTitle className="offline-dialog-title">您有未保存的更改</DialogTitle>
                                        <DialogDescription className="offline-dialog-description">
                                            离开此页面将导致所有未保存的修改丢失。
                                        </DialogDescription>
                                    </div>
                                </div>
                            </div>
                            <div className="offline-dialog-body" style={{ padding: '0 24px 20px' }}>
                                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                    您希望在离开前保存当前 Flow 的修改吗？
                                </p>
                            </div>
                            <div className="offline-dialog-actions" style={{ background: 'var(--color-surface-muted)', borderTop: '1px solid var(--color-border-subtle)', padding: '12px 20px' }}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCancelLeave}
                                >
                                    取消
                                </Button>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                        onClick={() => void handleConfirmLeave('discard')}
                                    >
                                        放弃修改
                                    </Button>
                                    <Button
                                        variant="default"
                                        size="sm"
                                        onClick={() => void handleConfirmLeave('save')}
                                    >
                                        保存并离开
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>

            {/* 点击其他区域关闭右键菜单 */}
            {contextMenuOpen && (
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                    onClick={() => setContextMenuOpen(false)}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenuOpen(false); }}
                />
            )}
        </section>
    );
}

