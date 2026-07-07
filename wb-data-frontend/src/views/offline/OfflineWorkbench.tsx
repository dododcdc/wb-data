import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '../../utils/error';
import { ReactFlowProvider } from '@xyflow/react';
import { useNavigate, useBlocker, useSearchParams } from 'react-router-dom';
import FlowCanvas from './FlowCanvas';
import '../core/RouteSkeletons.css';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '../../components/ui/resizable';
import {
    AlertTriangle,
    ArrowUpRight,
    ChevronRight,
    Database,
    FileCode2,
    FolderOpen,
    FolderPlus,
    GitBranch,
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
    getOfflineRepoTree,
    type OfflineExecutionDetail,
    type OfflineExecutionListItem,
    type OfflineRepoTreeNode,
    type OfflineRepoTreeResponse,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SimpleSelect } from '../../components/SimpleSelect';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useAuthStore } from '../../utils/auth';
import { NodeEditorDialog } from './NodeEditorDialog';
import { ScheduleDialog } from './ScheduleDialog';
import { UnsavedChangesDialog } from '../../components/ui/unsaved-changes-dialog';
import {
    flattenFlowDocumentNodes,
    resolveFlowSelectedTaskIds,
} from './flowDocumentMutations';
import { isExecuteButtonDisabled } from './executionToolbarState';
import { 
    getExecutionPresentation, 
    getExecutionStatusLabel, 
    getTaskStatusIcon,
    isRunningStatus,
    isStoppable 
} from './executionPresentation';
import {
    validateSqlNodeDataSourceRequirement,
} from './nodeEditorDataSourceRules';
import { SaveConflictDialog } from './SaveConflictDialog';
import { OfflineCommitDialogs } from './OfflineCommitDialogs';
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard';
import { useOfflineRepositoryWorkflow } from './useOfflineRepositoryWorkflow';
import { useOfflineTreeMutations } from './useOfflineTreeMutations';
import { useFlowExecutionAndSchedule } from './useFlowExecutionAndSchedule';
import { useFlowEditingSession } from './useFlowEditingSession';
import { useOfflineWorkbenchNavigation } from './useOfflineWorkbenchNavigation';

import './OfflineWorkbench.css';

function formatFlowPathDisplayName(flowPath: string) {
    const normalized = flowPath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const flowYamlIndex = segments.lastIndexOf('flow.yaml');
    if (flowYamlIndex > 0) {
        return segments[flowYamlIndex - 1];
    }
    return segments[segments.length - 1] ?? flowPath;
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
            {dirty && <span className="offline-toolbar-dot" />}
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
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent ref={(el) => { setDialogEl(el); }} className="offline-execution-dialog" hideClose>
                <DialogTitle className="sr-only">执行结果</DialogTitle>
                <div className="dialog-toolbar offline-dialog-toolbar">
                    <div className="offline-execution-toolbar-left">
                        <label className="offline-execution-filter">
                            <span>用户</span>
                            <div className="offline-execution-filter-control">
                                <SimpleSelect
                                    options={requestedByOptions}
                                    value={requestedByFilter == null ? 'ALL' : 'ME'}
                                    menuPlacement="down"
                                    menuContainer={dialogEl}
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

                        {(executions.some((item) => isStoppable(item.status)) || actionPending === 'ALL') && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="offline-button-stop"
                                onClick={onStopAll}
                                disabled={actionPending === 'ALL'}
                            >
                                {actionPending === 'ALL' ? <LoaderCircle size={14} className="offline-spin" /> : <TerminalSquare size={14} />}
                                停止
                            </Button>
                        )}
                        <button
                            type="button"
                            aria-label="关闭"
                            data-slot="dialog-close"
                            className="dialog-close-button"
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
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span>{formatDateTime(detail.startDate ?? detail.createdAt)}</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent>开始时间</TooltipContent>
                                                        </Tooltip>
                                                        <span className="meta-sep">→</span>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span>{detail.endDate ? formatDateTime(detail.endDate) : '进行中'}</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent>结束时间</TooltipContent>
                                                        </Tooltip>
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
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <div className="col-node">
                                                                                        <strong>{task.taskId}</strong>
                                                                                    </div>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>{task.taskId}</TooltipContent>
                                                                            </Tooltip>
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
            </DialogContent>
        </Dialog>
    );
}

export default function OfflineWorkbench() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const currentUser = useAuthStore((state) => state.userInfo);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const groupId = currentGroup?.id ?? null;
    const canWrite = systemAdmin || permissions.includes('offline.write');
    const isGroupAdmin = systemAdmin || permissions.includes('group.settings') || currentGroup?.role === 'GROUP_ADMIN';
    const defaultTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
    const { showFeedback } = useOperationFeedback();

    const [repoTree, setRepoTree] = useState<OfflineRepoTreeResponse | null>(null);
    const [treeLoading, setTreeLoading] = useState(false);
    const [flowCommitDialogOpen, setFlowCommitDialogOpen] = useState(false);
    const [repoCommitDialogOpen, setRepoCommitDialogOpen] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');
    const [committing, setCommitting] = useState(false);
    const [expandedTreeIds, setExpandedTreeIds] = useState<string[]>([]);
    const canvasBoardRef = useRef<HTMLDivElement>(null);
    const branchSwitcherRef = useRef<HTMLDivElement>(null);
    const previousGroupIdRef = useRef<number | null>(groupId);
    const loadScheduleSnapshotRef = useRef<((path: string) => Promise<void>) | null>(null);
    const resetExecutionAndScheduleRef = useRef<(() => void) | null>(null);
    const refreshRepoStatusRef = useRef<(() => Promise<void>) | null>(null);

    const loadScheduleSnapshotBridge = useCallback((path: string) => loadScheduleSnapshotRef.current?.(path) ?? Promise.resolve(), []);
    const resetExecutionAndScheduleBridge = useCallback(() => {
        resetExecutionAndScheduleRef.current?.();
    }, []);
    const refreshRepoStatusBridge = useCallback(() => refreshRepoStatusRef.current?.() ?? Promise.resolve(), []);

    const flowEditing = useFlowEditingSession({
        groupId,
        loadScheduleSnapshot: loadScheduleSnapshotBridge,
        showFeedback,
        refreshRepoStatus: refreshRepoStatusBridge,
        resetExecutionAndSchedule: resetExecutionAndScheduleBridge,
    });
    const {
        activeFlowPath,
        setActiveFlowPath,
        flowLoading,
        draftSession,
        setDraftSession,
        nodeEditorOpen,
        nodeEditorContent,
        savingFlow,
        flowCommitDirty,
        saveConflictState,
        isSaveConflictPending,
        flowDocument,
        activeNodeId,
        selectedTaskIds,
        staleDraft,
        activeNode,
        nodeCount,
        isDirty,
        canvasNodesRef,
        canvasEdgesRef,
        setSelectedNodeId: setDraftSelectedNodeId,
        setSelectedTaskIds: setDraftSelectedTaskIds,
        leaveCurrentFlow,
        discardCurrentFlowDraft,
        openFlowDocument: openFlowDocumentFromSession,
        resetAfterBranchSwitch,
        openNodeEditor: handleOpenNodeEditor,
        setNodeEditorOpen: handleNodeEditorOpenChange,
        updateNodeEditorContent: handleNodeEditorContentChange,
        stageNodeEditorDraft,
        saveNodeEditorDraft,
        saveFlow: handleSaveFlow,
        commitCurrentFlow,
        restoreStaleDraft: handleRestoreStaleDraft,
        discardStaleDraft: handleDiscardStaleDraft,
        closeSaveConflict: handleCloseSaveConflict,
        discardSaveConflict: handleDiscardSaveConflict,
        overwriteSaveConflict: handleOverwriteSaveConflict,
        refreshFlowCommitStatus,
        renameNode,
        addNode,
        updateCanvasNodes,
        updateCanvasEdges,
        commitCanvasLayout,
    } = flowEditing;
    const {
        repoStatus,
        repoLoading,
        branchLabel,
        canSwitchBranch,
        canCommitRepo,
        canPush,
        pushLoading,
        pushDialogOpen,
        setPushDialogOpen,
        rebuildLoading,
        rebuildDialogOpen,
        setRebuildDialogOpen,
        branchMenuOpen,
        setBranchMenuOpen,
        branchTooltipOpen,
        setBranchTooltipOpen,
        branchLoading,
        branches,
        resetBranchList,
        branchSwitching,
        branchDirtyState,
        pendingBranchSwitch,
        discardBranchSwitchOpen,
        setDiscardBranchSwitchOpen,
        requestBranchSwitch,
        confirmDiscardDraftAndSwitchBranch,
        resetBranchSwitchState,
        refreshRepoStatus,
        refreshRemoteStatus,
        commitRepo: commitRepository,
        push: pushRepository,
        rebuildRemote,
        toggleBranchMenu: handleBranchMenuToggle,
    } = useOfflineRepositoryWorkflow({
        groupId,
        canManageBranches: isGroupAdmin && !!groupId,
        hasUnsavedFlowDraft: isDirty,
        showFeedback,
    });
    refreshRepoStatusRef.current = refreshRepoStatus;
    const {
        executionDialogOpen,
        setExecutionDialogOpen,
        executions,
        executionsLoading,
        activeExecutionId,
        executionDetail,
        executionDetailLoading,
        executionActionPending,
        executionRequestedByFilter,
        setExecutionRequestedByFilter,
        scheduleDialogOpen,
        setScheduleDialogOpen,
        schedule,
        scheduleCron,
        setScheduleCron,
        scheduleTimezone,
        setScheduleTimezone,
        scheduleSaving,
        refreshExecutions,
        loadExecutionDetail,
        execute: handleExecute,
        stopExecution: handleStopExecution,
        stopAllExecutions: handleStopAllExecutions,
        loadScheduleSnapshot,
        stageSchedule: handleScheduleSave,
        toggleSchedule: handleScheduleToggle,
        resetExecutionAndSchedule,
    } = useFlowExecutionAndSchedule({
        groupId,
        activeFlowPath,
        draftSession,
        flowDocument,
        selectedTaskIds,
        nodeEditorOpen,
        defaultTimezone,
        canvasNodesRef,
        canvasEdgesRef,
        setDraftSession,
        showFeedback,
    });
    loadScheduleSnapshotRef.current = loadScheduleSnapshot;
    resetExecutionAndScheduleRef.current = resetExecutionAndSchedule;

    const nodeIssues = useMemo(() => {
        if (!flowDocument) return {};
        const issues: Record<string, string | null> = {};
        flattenFlowDocumentNodes(flowDocument).forEach(node => {
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
    const currentBranchFromList = useMemo(
        () => branches.find((branch) => branch.current) ?? branches.find((branch) => branch.name === branchLabel) ?? null,
        [branches, branchLabel],
    );
    const switchableBranches = useMemo(
        () => branches.filter((branch) => !branch.current && branch.name !== branchLabel),
        [branches, branchLabel],
    );

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

    const refreshWorkspace = useCallback(async () => {
        await Promise.all([
            refreshRepoStatus(),
            refreshRepoTree(),
            refreshRemoteStatus(),
        ]);
    }, [refreshRepoStatus, refreshRepoTree, refreshRemoteStatus]);

    const resetActiveFlowAfterBranchSwitch = useCallback(() => {
        resetAfterBranchSwitch();
    }, [resetAfterBranchSwitch]);

    const {
        pendingNavigation,
        openFlowDocument,
        markDraftDiscardedForExternalSwitch,
        confirmLeave: handleConfirmLeave,
        cancelLeave: handleCancelLeave,
        setPendingRouterNavigation,
    } = useOfflineWorkbenchNavigation({
        groupId,
        draftSession,
        isDirty,
        openFlowDocumentFromSession,
        saveCurrentFlow: handleSaveFlow,
        discardCurrentFlowDraft,
        resetActiveFlow: resetActiveFlowAfterBranchSwitch,
    });

    useBeforeUnloadGuard(isDirty);

    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) =>
            isDirty && currentLocation.pathname !== nextLocation.pathname
    );

    useEffect(() => {
        if (blocker.state === 'blocked') {
            setPendingRouterNavigation(blocker);
        }
    }, [blocker, setPendingRouterNavigation]);

    const discardActiveDraftForBranchSwitch = useCallback(() => {
        markDraftDiscardedForExternalSwitch();
    }, [markDraftDiscardedForExternalSwitch]);

    const handleBranchSwitchRequest = useCallback((branchName: string) => {
        requestBranchSwitch(branchName, {
            hasUnsavedDraft: isDirty,
            discardDraft: discardActiveDraftForBranchSwitch,
            afterSwitch: async () => {
                resetActiveFlowAfterBranchSwitch();
                await refreshWorkspace();
            },
        });
    }, [discardActiveDraftForBranchSwitch, isDirty, refreshWorkspace, requestBranchSwitch, resetActiveFlowAfterBranchSwitch]);

    const {
        newFlowDialogOpen,
        setNewFlowDialogOpen,
        newFlowName,
        setNewFlowName,
        newFlowCreating,
        newFlowParentPath,
        setNewFlowParentPath,
        newFolderDialogOpen,
        setNewFolderDialogOpen,
        newFolderName,
        setNewFolderName,
        newFolderCreating,
        newFolderParentPath,
        setNewFolderParentPath,
        newItemMenuOpen,
        setNewItemMenuOpen,
        contextMenuOpen,
        setContextMenuOpen,
        contextMenuPosition,
        contextMenuNode,
        deleteFlowDialogOpen,
        setDeleteFlowDialogOpen,
        deleteFlowName,
        deleteFlowLoading,
        deleteFolderDialogOpen,
        setDeleteFolderDialogOpen,
        deleteFolderName,
        deleteFolderLoading,
        renameFlowDialogOpen,
        setRenameFlowDialogOpen,
        renameFlowName,
        setRenameFlowName,
        renameFlowOriginalName,
        renameFlowLoading,
        renameFolderDialogOpen,
        setRenameFolderDialogOpen,
        renameFolderName,
        setRenameFolderName,
        renameFolderOriginalName,
        renameFolderLoading,
        handleCreateFlow,
        handleCreateFolder,
        handleDeleteFlow,
        handleRenameFlow,
        handleDeleteFolder,
        handleRenameFolder,
        handleContextMenu,
        openNewFlowDialogFromContext,
        openNewFolderDialogFromContext,
        openDeleteFlowDialogFromContext,
        openDeleteFolderDialogFromContext,
        openRenameFlowDialogFromContext,
        openRenameFolderDialogFromContext,
        openRootNewFlowDialog,
    } = useOfflineTreeMutations({
        groupId,
        activeFlowPath,
        draftSession,
        refreshRepoTree,
        openFlowDocument,
        leaveCurrentFlow,
        setActiveFlowPath,
        setDraftSession,
        showFeedback,
    });

    useEffect(() => {
        if (!branchMenuOpen) return;

        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target;
            if (target instanceof Node && branchSwitcherRef.current?.contains(target)) {
                return;
            }
            setBranchMenuOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setBranchMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [branchMenuOpen, setBranchMenuOpen]);

    useEffect(() => {
        const previousGroupId = previousGroupIdRef.current;
        if (previousGroupId !== null && previousGroupId !== groupId) {
            leaveCurrentFlow(undefined, previousGroupId);
        }
        previousGroupIdRef.current = groupId;

        resetActiveFlowAfterBranchSwitch();
        resetBranchList();
        resetBranchSwitchState();

        if (!groupId) return;
        void refreshWorkspace();
    }, [groupId, leaveCurrentFlow, refreshWorkspace, resetActiveFlowAfterBranchSwitch, resetBranchList, resetBranchSwitchState]);

    useEffect(() => {
        const handleBranchChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ groupId?: number; source?: string }>).detail;
            if (!groupId || detail?.groupId !== groupId) return;
            if (detail?.source === 'workbench') return;

            resetBranchList();
            resetBranchSwitchState();
            resetActiveFlowAfterBranchSwitch();
            void refreshWorkspace();
        };

        window.addEventListener('wbdata:offline-branch-changed', handleBranchChanged);
        return () => window.removeEventListener('wbdata:offline-branch-changed', handleBranchChanged);
    }, [groupId, refreshWorkspace, resetActiveFlowAfterBranchSwitch, resetBranchList, resetBranchSwitchState]);

    // Restore flow from URL param (e.g. returning from execution log page)
    const restoreFlowRef = useRef(false);
    useEffect(() => {
        if (!groupId || !repoTree || restoreFlowRef.current) return;
        const flowPath = searchParams.get('flowPath');
        if (!flowPath) return;
        restoreFlowRef.current = true;
        void openFlowDocument(flowPath, { force: true });
    }, [groupId, repoTree, searchParams, openFlowDocument]);

    useEffect(() => {
        if (!groupId || !draftSession) return;
        const handleBeforeUnload = () => {
            leaveCurrentFlow();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [draftSession, groupId, leaveCurrentFlow]);

    // Ctrl/Cmd+N to open new Flow dialog
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
                e.preventDefault();
                if (!newFlowDialogOpen && !nodeEditorOpen && !executionDialogOpen && !scheduleDialogOpen) {
                    openRootNewFlowDialog();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [newFlowDialogOpen, nodeEditorOpen, executionDialogOpen, scheduleDialogOpen, openRootNewFlowDialog]);



    const handleToggleTaskSelection = useCallback((taskId: string) => {
        setDraftSelectedTaskIds((current) => current.includes(taskId)
            ? current.filter((item) => item !== taskId)
            : [...current, taskId]);
    }, [setDraftSelectedTaskIds]);

    const handleReplaceTaskSelection = useCallback((taskIds: string[]) => {
        setDraftSelectedTaskIds(resolveFlowSelectedTaskIds(flowDocument, taskIds));
    }, [flowDocument, setDraftSelectedTaskIds]);

    const handleToggleTreeNode = useCallback((nodeId: string) => {
        setExpandedTreeIds((current) => current.includes(nodeId)
            ? current.filter((item) => item !== nodeId)
            : [...current, nodeId]);
        }, []);

    const handleNodeEditorTempSave = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
        if (!activeNodeId) return;
        saveNodeEditorDraft(content, dataSourceId, dataSourceType);
        const activeEditingNode = flattenFlowDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
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
    }, [activeNodeId, flowDocument, saveNodeEditorDraft, showFeedback]);

    const handleNodeEditorDraftChange = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
        stageNodeEditorDraft(content, dataSourceId, dataSourceType);
    }, [stageNodeEditorDraft]);

    const handleFlowCommit = useCallback(async (mode: 'save-and-commit' | 'saved-only') => {
        if (!groupId || !activeFlowPath) return;
        setCommitting(true);
        try {
            const committed = await commitCurrentFlow(commitMessage, mode);
            if (committed) {
                setFlowCommitDialogOpen(false);
                setCommitMessage('');
            }
        } finally {
            setCommitting(false);
        }
    }, [activeFlowPath, commitCurrentFlow, commitMessage, groupId]);

    const handleOpenScheduleDialog = useCallback(() => {
        setScheduleDialogOpen(true);
        if (activeFlowPath) {
            void loadScheduleSnapshot(activeFlowPath);
        }
    }, [activeFlowPath, loadScheduleSnapshot, setScheduleDialogOpen]);

    const handleRepoCommit = useCallback(async (mode: 'save-and-commit' | 'saved-only') => {
        if (!groupId) return;
        setCommitting(true);
        try {
            const committed = await commitRepository(commitMessage, {
                saveCurrentFlowBeforeCommit: mode === 'save-and-commit' && activeFlowPath && isDirty
                    ? () => handleSaveFlow(undefined, false)
                    : undefined,
                afterCommit: refreshFlowCommitStatus,
            });
            if (committed) {
                setRepoCommitDialogOpen(false);
                setCommitMessage('');
            }
        } finally {
            setCommitting(false);
        }
    }, [groupId, activeFlowPath, commitMessage, isDirty, handleSaveFlow, commitRepository, refreshFlowCommitStatus]);

    const handleOpenFlowCommitDialog = useCallback(() => {
        if (!groupId || !activeFlowPath || !flowDocument) return;
        setFlowCommitDialogOpen(true);
    }, [groupId, activeFlowPath, flowDocument]);

    const handleOpenRepoCommitDialog = useCallback(() => {
        if (!groupId) return;
        setRepoCommitDialogOpen(true);
    }, [groupId]);

    return (
        <section className="offline-page">
            <ResizablePanelGroup 
                direction="horizontal" 
                className="offline-workbench-resizable-shell"
                autoSaveId="offline-workbench-layout"
            >
                <ResizablePanel
                    id="sidebar"
                    order={1}
                    defaultSize={20}
                    minSize={15}
                    maxSize={40}
                    className="offline-rail-panel-container"
                >
                    <aside className="offline-rail h-full">
                        <div className="offline-rail-toolbar">
                            <div className="offline-branch-switcher" ref={branchSwitcherRef}>
                                {canSwitchBranch ? (
                                    <Tooltip open={branchMenuOpen ? false : branchTooltipOpen} onOpenChange={setBranchTooltipOpen}>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="offline-branch-selector offline-branch-selector-button"
                                                aria-label={`切换分支，当前 ${branchLabel}`}
                                                aria-expanded={branchMenuOpen}
                                                onClick={handleBranchMenuToggle}
                                                disabled={repoLoading || treeLoading || branchSwitching}
                                            >
                                                <GitBranch size={14} />
                                                <span className="offline-branch-selector-value">{branchLabel}</span>
                                                <ChevronRight size={12} className={`offline-branch-badge-caret ${branchMenuOpen ? 'is-open' : ''}`} />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            当前分支：{branchLabel}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="offline-branch-selector offline-branch-selector-readonly">
                                                <GitBranch size={14} />
                                                <span className="offline-branch-selector-value">{branchLabel}</span>
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            当前分支：{branchLabel}。只有项目组管理员可以切换分支
                                        </TooltipContent>
                                    </Tooltip>
                                )}

                                {canSwitchBranch ? (
                                    <div className={`offline-branch-menu ${branchMenuOpen ? 'open' : ''}`} role="dialog" aria-label="切换分支" aria-hidden={!branchMenuOpen}>
                                        <div className="offline-branch-menu-inner">
                                            <div className="offline-branch-menu-surface">
                                                {branchDirtyState ? (
                                                    <div className="offline-branch-dirty-warning">
                                                        <AlertTriangle size={14} />
                                                        <div>
                                                            <strong>还有已保存但未提交的 Flow</strong>
                                                            {branchDirtyState.changedFlowDetails.length > 0 ? (
                                                                <ul>
                                                                    {branchDirtyState.changedFlowDetails.slice(0, 5).map((flow) => (
                                                                        <li key={flow.path}>
                                                                            {formatFlowPathDisplayName(flow.path)}
                                                                            {flow.status === 'DELETED' ? <span>已删除</span> : null}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            ) : (
                                                                <p>当前仓库有已保存但未提交的改动。</p>
                                                            )}
                                                            {branchDirtyState.otherFileCount > 0 ? (
                                                                <p>还有 {branchDirtyState.otherFileCount} 个仓库文件未提交。</p>
                                                            ) : null}
                                                            <button
                                                                type="button"
                                                                className="offline-branch-dirty-action"
                                                                aria-label="打开提交仓库改动"
                                                                onClick={() => {
                                                                    setBranchMenuOpen(false);
                                                                    setRepoCommitDialogOpen(true);
                                                                }}
                                                            >
                                                                提交仓库改动
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {branchLoading ? (
                                                    <div className="offline-branch-menu-empty">
                                                        <LoaderCircle size={14} className="offline-spin" />
                                                        正在加载分支...
                                                    </div>
                                                ) : (
                                                    <div className="offline-branch-list" aria-label="可切换分支">
                                                        {currentBranchFromList ? (
                                                            <div className="offline-branch-row is-current" title={currentBranchFromList.name}>
                                                                <div>
                                                                    <strong>{currentBranchFromList.name}</strong>
                                                                </div>
                                                            </div>
                                                        ) : null}
                                                        {switchableBranches.map((branch) => (
                                                            <button
                                                                key={branch.name}
                                                                type="button"
                                                                className="offline-branch-row"
                                                                aria-label={`切换到 ${branch.name}`}
                                                                title={branch.name}
                                                                onClick={() => handleBranchSwitchRequest(branch.name)}
                                                                disabled={branchSwitching}
                                                            >
                                                                <div>
                                                                    <strong>{branch.name}</strong>
                                                                </div>
                                                            </button>
                                                        ))}
                                                        {!currentBranchFromList && switchableBranches.length === 0 ? (
                                                            <div className="offline-branch-menu-empty" role="note" aria-label="暂无其他可切换分支">暂无其他可切换分支</div>
                                                        ) : null}
                                                        {currentBranchFromList && switchableBranches.length === 0 ? (
                                                            <div className="offline-branch-menu-empty" role="note" aria-label="暂无其他可切换分支">暂无其他可切换分支</div>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                            {canWrite && (
                                <div className="offline-rail-toolbar-actions">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="offline-rail-toolbar-btn-wrapper">
                                                <button
                                                    type="button"
                                                    className="offline-rail-toolbar-btn"
                                                    aria-label="新建"
                                                    onClick={() => setNewItemMenuOpen(!newItemMenuOpen)}
                                                    disabled={!groupId || repoLoading || treeLoading || flowLoading}
                                                >
                                                    <Plus size={14} />
                                                </button>
                                                {newItemMenuOpen && (
                                                    <div
                                                        className="offline-new-item-menu animate-in fade-in zoom-in-95"
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
                                            </div>
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

                                    {isGroupAdmin && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="offline-rail-toolbar-btn"
                                                    aria-label="提交仓库改动"
                                                    onClick={() => void handleOpenRepoCommitDialog()}
                                                    disabled={!canCommitRepo || committing || repoLoading || treeLoading}
                                                >
                                                    <span className="relative flex">
                                                        <GitCommitHorizontal size={14} />
                                                        {(isDirty || repoStatus?.dirty) && <span className="offline-toolbar-dot" />}
                                                    </span>
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent className="tooltip-content" side="bottom">
                                                提交仓库改动
                                            </TooltipContent>
                                        </Tooltip>
                                    )}
                                    {isGroupAdmin && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="offline-rail-toolbar-btn"
                                                    aria-label="推送"
                                                    onClick={() => setPushDialogOpen(true)}
                                                    disabled={!canPush || pushLoading || repoLoading || treeLoading}
                                                >
                                                    {pushLoading ? <LoaderCircle size={14} className="offline-spin" /> : <GitPushIcon dirty={!!repoStatus?.ahead} />}
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent className="tooltip-content" side="bottom">
                                                推送
                                            </TooltipContent>
                                        </Tooltip>
                                    )}
                                </div>
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
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel id="main" order={2} defaultSize={80}>
                    <main className="offline-main-panel h-full animate-enter animate-enter-delay-1">
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
                                                    setDraftSelectedTaskIds(flattenFlowDocumentNodes(flowDocument).map((n) => n.taskId));
                                                } else {
                                                    setDraftSelectedTaskIds([]);
                                                }
                                            }}
                                            disabled={nodeCount === 0}
                                        />
                                        全选
                                    </label>

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
                                                    disabled={!activeFlowPath || !canWrite || !(isDirty || flowCommitDirty) || committing}
                                                    onClick={() => void handleOpenFlowCommitDialog()}
                                                    aria-label="提交当前 Flow"
                                                >
                                                    <span className="relative flex">
                                                        <GitCommitHorizontal size={16} />
                                                        {(isDirty || flowCommitDirty) && <span className="offline-toolbar-dot" />}
                                                    </span>
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent className="tooltip-content" side="bottom">
                                                提交当前 Flow
                                            </TooltipContent>
                                        </Tooltip>

                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="offline-canvas-toolbar-btn"
                                                    disabled={!activeFlowPath || !canWrite}
                                                    onClick={handleOpenScheduleDialog}
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
                                                        addNode('SQL', center);
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
                                                        addNode('HIVE_SQL', center);
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
                                                        addNode('SHELL', center);
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
                                            onNodesChange={updateCanvasNodes}
                                            onEdgesChange={updateCanvasEdges}
                                            onNodeLayoutCommit={commitCanvasLayout}
                                            onSelectNode={setDraftSelectedNodeId}
                                            onToggleTaskSelection={handleToggleTaskSelection}
                                            onReplaceTaskSelection={handleReplaceTaskSelection}
                                            onDoubleClickNode={handleOpenNodeEditor}
                                            onAddNode={addNode}
                                            onRenameNode={renameNode}
                                        />
                                    </ReactFlowProvider>
                                </section>
                            </>
                        )}
                    </main>
                </ResizablePanel>
            </ResizablePanelGroup>

            <SaveConflictDialog
                open={saveConflictState !== null}
                pending={isSaveConflictPending}
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
                onOpenExecutionPage={(executionId) => {
                    const params = new URLSearchParams();
                    if (activeFlowPath) params.set('flowPath', activeFlowPath);
                    navigate(`/offline/executions/${encodeURIComponent(executionId)}${params.toString() ? `?${params.toString()}` : ''}`);
                }}
                onStopAll={() => void handleStopAllExecutions()}
                onOpenTaskLogs={(executionId, taskId) => window.open(`/offline/executions/${encodeURIComponent(executionId)}?taskId=${encodeURIComponent(taskId)}`, '_blank')}
                onRequestedByFilterChange={(requestedBy) => {
                    setExecutionRequestedByFilter(requestedBy);
                    void refreshExecutions(activeExecutionId, requestedBy);
                }}
            />

            <ScheduleDialog
                open={scheduleDialogOpen}
                schedule={schedule}
                cron={scheduleCron || ''}
                timezone={scheduleTimezone || ''}
                saving={scheduleSaving}
                flowId={flowDocument?.flowId ?? null}
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

            <OfflineCommitDialogs
                flowCommitOpen={flowCommitDialogOpen}
                repoCommitOpen={repoCommitDialogOpen}
                commitMessage={commitMessage}
                committing={committing}
                flowDraftDirty={isDirty}
                flowCommitDirty={flowCommitDirty}
                repoDraftDirty={isDirty}
                repoDirty={!!repoStatus?.dirty}
                onFlowCommitOpenChange={(open) => {
                    setFlowCommitDialogOpen(open);
                    if (!open) { setCommitMessage(''); }
                }}
                onRepoCommitOpenChange={(open) => {
                    setRepoCommitDialogOpen(open);
                    if (!open) { setCommitMessage(''); }
                }}
                onCommitMessageChange={setCommitMessage}
                onCommitFlow={(mode) => void handleFlowCommit(mode)}
                onCommitRepo={(mode) => void handleRepoCommit(mode)}
            />

            <Dialog open={pushDialogOpen} onOpenChange={setPushDialogOpen}>
                <DialogContent style={{ maxWidth: '420px' }}>
                    <DialogHeader>
                        <DialogTitle>推送</DialogTitle>
                        <DialogDescription className="sr-only">
                            确认将本地提交推送到远端仓库
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body">
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                            将本地提交推送到远端仓库，推送后其他成员可以拉取最新内容。
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPushDialogOpen(false)} disabled={pushLoading}>
                            取消
                        </Button>
                        <Button variant="default" onClick={() => void pushRepository()} disabled={pushLoading}>
                            {pushLoading ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {pushLoading ? '推送中…' : '推送'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={discardBranchSwitchOpen}
                onOpenChange={(open) => {
                    if (!open && branchSwitching) return;
                    setDiscardBranchSwitchOpen(open);
                }}
                title="放弃画布草稿并切换分支"
                description={
                    pendingBranchSwitch
                        ? `当前 Flow 有未保存的画布草稿。切换到 ${pendingBranchSwitch} 前需要放弃这些草稿。`
                        : '当前 Flow 有未保存的画布草稿，切换分支前需要放弃这些草稿。'
                }
                confirmText="放弃草稿并切换"
                variant="destructive"
                icon="warning"
                onConfirm={confirmDiscardDraftAndSwitchBranch}
                isLoading={branchSwitching}
            />

            <Dialog open={rebuildDialogOpen} onOpenChange={setRebuildDialogOpen}>
                <DialogContent style={{ maxWidth: '420px' }}>
                    <DialogHeader>
                        <DialogTitle>远程仓库已不存在</DialogTitle>
                        <DialogDescription className="sr-only">
                            远程仓库已被删除，是否重建并推送
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body">
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                            远程仓库已被删除，是否重建仓库并推送本地内容？
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRebuildDialogOpen(false)} disabled={rebuildLoading}>
                            取消
                        </Button>
                        <Button variant="default" onClick={() => void rebuildRemote()} disabled={rebuildLoading}>
                            {rebuildLoading ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {rebuildLoading ? '推送中…' : '重建并推送'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
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
                <DialogContent style={{ maxWidth: '520px' }}>
                    <DialogHeader>
                        <DialogTitle>新建 Flow</DialogTitle>
                        <DialogDescription>
                            输入 Flow 名称，将自动创建空白的 Flow 文件
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body">
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
                    <DialogFooter>
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
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={newFolderDialogOpen} onOpenChange={(open) => {
                setNewFolderDialogOpen(open);
                if (!open) {
                    setNewFolderName('');
                    setNewFolderParentPath('');
                }
            }}>
                <DialogContent style={{ maxWidth: '460px' }}>
                    <DialogHeader>
                        <DialogTitle>新建文件夹</DialogTitle>
                        <DialogDescription>
                            输入文件夹名称，将在指定路径下创建文件夹
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body">
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
                    <DialogFooter>
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
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={deleteFlowDialogOpen}
                onOpenChange={(nextOpen) => {
                    if (!deleteFlowLoading) {
                        setDeleteFlowDialogOpen(nextOpen);
                    }
                }}
                title="确认删除 Flow"
                description={`确定要删除 Flow「${deleteFlowName}」吗？此操作不可恢复。`}
                confirmText="删除"
                cancelText="取消"
                variant="destructive"
                icon="warning"
                isLoading={deleteFlowLoading}
                onConfirm={() => void handleDeleteFlow()}
            />

            <ConfirmDialog
                open={deleteFolderDialogOpen}
                onOpenChange={(nextOpen) => {
                    if (!deleteFolderLoading) {
                        setDeleteFolderDialogOpen(nextOpen);
                    }
                }}
                title="确认删除文件夹"
                description={`确定要删除文件夹「${deleteFolderName}」吗？其下所有内容都将被物理删除，此操作不可恢复。`}
                confirmText="删除"
                cancelText="取消"
                variant="destructive"
                icon="warning"
                isLoading={deleteFolderLoading}
                onConfirm={() => void handleDeleteFolder()}
            />

            {/* 重命名文件夹对话框 */}
            <Dialog open={renameFolderDialogOpen} onOpenChange={setRenameFolderDialogOpen}>
                <DialogContent style={{ maxWidth: '420px' }}>
                    <DialogHeader>
                        <DialogTitle>重命名文件夹</DialogTitle>
                        <DialogDescription>
                            将文件夹「{renameFolderOriginalName}」重命名为：
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body" style={{ marginTop: 12 }}>
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
                    <DialogFooter>
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
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 重命名 Flow 对话框 */}
            <Dialog open={renameFlowDialogOpen} onOpenChange={setRenameFlowDialogOpen}>
                <DialogContent style={{ maxWidth: '420px' }}>
                    <DialogHeader>
                        <DialogTitle>重命名 Flow</DialogTitle>
                        <DialogDescription>
                            将「{renameFlowOriginalName}」重命名为：
                        </DialogDescription>
                    </DialogHeader>
                    <div className="dialog-body" style={{ marginTop: 12 }}>
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
                    <DialogFooter>
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
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 右键菜单 */}
            {contextMenuOpen && contextMenuPosition && (
                <div
                    className="offline-context-menu"
                    style={{
                        position: 'fixed',
                        left: contextMenuPosition.x,
                        top: contextMenuPosition.y,
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

            <UnsavedChangesDialog
                open={pendingNavigation !== null}
                onOpenChange={(open) => { if (!open) handleCancelLeave(); }}
                onSave={() => void handleConfirmLeave('save')}
                onDiscard={() => void handleConfirmLeave('discard')}
            />

            {/* 点击其他区域关闭右键菜单 */}
            {contextMenuOpen && (
                <div
                    className="offline-context-menu-backdrop"
                    onClick={() => setContextMenuOpen(false)}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenuOpen(false); }}
                />
            )}
        </section>
    );
}
