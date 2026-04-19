import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { AxiosError } from 'axios';
import { ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import { loadQueryEditorModule } from '../query/queryEditorModule';
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
    Inbox,
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
} from 'lucide-react';
import {
    commitOfflineRepo,
    createOfflineFolder,
    createOfflineSavedDebugExecution,
    deleteOfflineFlow,
    deleteOfflineFolder,
    getOfflineExecution,
    getOfflineExecutionLogs,
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
    type OfflineExecutionLogEntry,
    type OfflineFlowDocument,
    type OfflineFlowEdge,
    type OfflineFlowNode,
    type OfflineRepoStatus,
    type RemoteStatus,
    type OfflineRepoTreeNode,
    type OfflineRepoTreeResponse,
    type OfflineScheduleResponse,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
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
import { registerEditorThemes } from '../query/editorUtils';
import {
    applyCanvasStateToDocument,
    buildEdgesFromCanvasEdges,
    buildFlowDocumentSignature,
    buildLayoutFromCanvasNodes,
} from './flowCanvasState';
import {
    buildNodeEditorDataSourceOptions,
    findFirstSqlNodeMissingDataSource,
    validateSqlNodeDataSourceRequirement,
} from './nodeEditorDataSourceRules';
import { OfflineDataSourcePicker } from './OfflineDataSourcePicker';
import { useNodeEditorDataSources } from './useNodeEditorDataSources';
import { cn } from '../../lib/utils';
import './OfflineWorkbench.css';

interface FlowDocumentDraft {
    document: OfflineFlowDocument;
    savedAt: number;
    documentUpdatedAt: number;
    originalSignature: string;
    selectedNodeId: string | null;
    selectedTaskIds: string[];
}

function cloneFlowDocument(document: OfflineFlowDocument): OfflineFlowDocument {
    return {
        ...document,
        stages: document.stages.map((stage) => ({
            ...stage,
            nodes: stage.nodes.map((node) => ({ ...node })),
        })),
        edges: document.edges.map((edge) => ({ ...edge })),
        layout: Object.fromEntries(
            Object.entries(document.layout).map(([taskId, position]) => [taskId, { ...position }]),
        ),
    };
}

function flattenDocumentNodes(document: OfflineFlowDocument | null) {
    return document?.stages.flatMap((stage) => stage.nodes) ?? [];
}

function draftStorageKey(groupId: number, path: string) {
    return `wb-data:draft:${groupId}:${path}`;
}

function readDraft(groupId: number, path: string): FlowDocumentDraft | null {
    const raw = window.localStorage.getItem(draftStorageKey(groupId, path));
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<FlowDocumentDraft>;
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.savedAt !== 'number' || typeof parsed.documentUpdatedAt !== 'number') return null;
        if (typeof parsed.originalSignature !== 'string') return null;
        if (!parsed.document || !Array.isArray(parsed.document.stages)) return null;
        return parsed as FlowDocumentDraft;
    } catch {
        return null;
    }
}

function writeDraft(groupId: number, path: string, draft: FlowDocumentDraft) {
    window.localStorage.setItem(draftStorageKey(groupId, path), JSON.stringify(draft));
}

function clearDraft(groupId: number, path: string) {
    window.localStorage.removeItem(draftStorageKey(groupId, path));
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
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date);
}

function formatDuration(durationMs: number | null) {
    if (durationMs == null) return '—';
    if (durationMs < 1000) return `${durationMs}ms`;
    const seconds = durationMs / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remain = Math.round(seconds % 60);
    return `${minutes}m ${remain}s`;
}

function isRunningStatus(status: string | null | undefined) {
    return status === 'RUNNING' || status === 'CREATED' || status === 'QUEUED' || status === 'PAUSED';
}

function inferStatusTone(status: string | null | undefined) {
    if (!status) return 'neutral';
    if (status === 'SUCCESS') return 'success';
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'KILLED') return 'danger';
    if (isRunningStatus(status)) return 'active';
    return 'neutral';
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
    logs: OfflineExecutionLogEntry[];
    logTaskFilter: string | null;
    activeExecutionId: string | null;
    actionPending: string | null;
    onOpenChange: (open: boolean) => void;
    onRefresh: () => void;
    onSelectExecution: (executionId: string, taskId?: string | null) => void;
    onStopExecution: (executionId: string) => void;
    onStopAll: () => void;
}

function ExecutionDialog(props: ExecutionDialogProps) {
    const {
        open,
        flowPath,
        executions,
        loading,
        detail,
        detailLoading,
        logs,
        logTaskFilter,
        activeExecutionId,
        actionPending,
        onOpenChange,
        onRefresh,
        onSelectExecution,
        onStopExecution,
        onStopAll,
    } = props;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPortal>
                <DialogOverlay className="offline-dialog-backdrop" />
                <DialogContent className="offline-dialog-positioner">
                    <div className="offline-dialog-card offline-execution-dialog">
                        <div className="offline-dialog-header">
                            <div>
                                <DialogTitle className="offline-dialog-title">执行结果</DialogTitle>
                                <DialogDescription className="offline-dialog-description">
                                    {flowPath ?? '尚未选择 Flow'}
                                </DialogDescription>
                            </div>
                            <button
                                className="offline-dialog-close"
                                type="button"
                                aria-label="关闭执行结果"
                                onClick={() => onOpenChange(false)}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="offline-dialog-toolbar">
                            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                                <RefreshCcw size={14} />
                                刷新
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onStopAll}
                                disabled={executions.every((item) => !isRunningStatus(item.status)) || actionPending === 'ALL'}
                            >
                                {actionPending === 'ALL' ? <LoaderCircle size={14} className="offline-spin" /> : <TerminalSquare size={14} />}
                                停止所有
                            </Button>
                        </div>

                        <div className="offline-execution-layout">
                            <section className="offline-execution-list">
                                {loading ? (
                                    <div className="offline-list-placeholder">正在加载执行记录...</div>
                                ) : executions.length === 0 ? (
                                    <div className="offline-list-placeholder">当前 Flow 还没有执行记录。</div>
                                ) : (
                                    executions.map((item) => (
                                        <button
                                            key={item.executionId}
                                            type="button"
                                            className={`offline-execution-row${item.executionId === activeExecutionId ? ' is-active' : ''}`}
                                            onClick={() => onSelectExecution(item.executionId, null)}
                                        >
                                            <div className="offline-execution-row-main">
                                                <div className="offline-execution-row-title">
                                                    <strong>{item.executionId}</strong>
                                                    <StatusPill tone={inferStatusTone(item.status)}>{item.status}</StatusPill>
                                                </div>
                                                <span className="offline-execution-row-meta">
                                                    {formatDateTime(item.startDate)} · {formatDuration(item.durationMs)}
                                                </span>
                                            </div>
                                            {isRunningStatus(item.status) ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onStopExecution(item.executionId);
                                                    }}
                                                    disabled={actionPending === item.executionId}
                                                >
                                                    {actionPending === item.executionId ? <LoaderCircle size={14} className="offline-spin" /> : '停止'}
                                                </Button>
                                            ) : null}
                                        </button>
                                    ))
                                )}
                            </section>

                            <section className="offline-execution-detail">
                                {detailLoading ? (
                                    <div className="offline-list-placeholder">正在加载执行详情...</div>
                                ) : !detail ? (
                                    <div className="offline-list-placeholder">选择一条执行记录查看详情与日志。</div>
                                ) : (
                                    <>
                                        <div className="offline-detail-header">
                                            <div className="offline-detail-kpis">
                                                <div>
                                                    <span>状态</span>
                                                    <strong>{detail.status}</strong>
                                                </div>
                                                <div>
                                                    <span>开始</span>
                                                    <strong>{formatDateTime(detail.startDate ?? detail.createdAt)}</strong>
                                                </div>
                                                <div>
                                                    <span>结束</span>
                                                    <strong>{formatDateTime(detail.endDate)}</strong>
                                                </div>
                                            </div>
                                            <div className="offline-detail-source">
                                                <span>来源版本</span>
                                                <code>{detail.sourceRevision.slice(0, 12)}</code>
                                            </div>
                                        </div>

                                        <div className="offline-task-run-strip">
                                            <button
                                                type="button"
                                                className={`offline-task-chip${logTaskFilter === null ? ' is-active' : ''}`}
                                                onClick={() => onSelectExecution(detail.executionId, null)}
                                            >
                                                全部日志
                                            </button>
                                            {detail.taskRuns.map((taskRun) => (
                                                <button
                                                    key={taskRun.taskId}
                                                    type="button"
                                                    className={`offline-task-chip${logTaskFilter === taskRun.taskId ? ' is-active' : ''}`}
                                                    onClick={() => onSelectExecution(detail.executionId, taskRun.taskId)}
                                                >
                                                    {taskRun.taskId}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="offline-log-surface">
                                            {logs.length === 0 ? (
                                                <div className="offline-list-placeholder">当前筛选条件下没有日志。</div>
                                            ) : (
                                                logs.map((entry, index) => (
                                                    <div key={`${entry.timestamp ?? 'log'}-${index}`} className="offline-log-line">
                                                        <span>{formatDateTime(entry.timestamp)}</span>
                                                        <strong>{entry.level ?? 'INFO'}</strong>
                                                        <em>{entry.taskId ?? 'flow'}</em>
                                                        <p>{entry.message ?? ''}</p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </>
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
    const currentGroup = useAuthStore((state) => state.currentGroup);
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
    const [flowDocument, setFlowDocument] = useState<OfflineFlowDocument | null>(null);
    const [originalDocumentSignature, setOriginalDocumentSignature] = useState('');
    const [staleDraft, setStaleDraft] = useState<FlowDocumentDraft | null>(null);
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
    const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
    const [executionDialogOpen, setExecutionDialogOpen] = useState(false);
    const [executions, setExecutions] = useState<OfflineExecutionListItem[]>([]);
    const [executionsLoading, setExecutionsLoading] = useState(false);
    const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
    const [executionDetail, setExecutionDetail] = useState<OfflineExecutionDetail | null>(null);
    const [executionLogs, setExecutionLogs] = useState<OfflineExecutionLogEntry[]>([]);
    const [executionDetailLoading, setExecutionDetailLoading] = useState(false);
    const [logTaskFilter, setLogTaskFilter] = useState<string | null>(null);
    const [executionActionPending, setExecutionActionPending] = useState<string | null>(null);
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

    const activeNode = useMemo(() => flattenDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null, [activeNodeId, flowDocument]);
    const nodeCount = useMemo(() => flattenDocumentNodes(flowDocument).length, [flowDocument]);
    const isDirty = flowDocument !== null && buildFlowDocumentSignature(flowDocument) !== originalDocumentSignature;

    const nodeIssues = useMemo(() => {
        if (!flowDocument) return {};
        const issues: Record<string, string | null> = {};
        flattenDocumentNodes(flowDocument).forEach(node => {
            const validation = validateSqlNodeDataSourceRequirement({
                kind: node.kind,
                dataSourceId: node.dataSourceId,
                strict: true,
            });
            if (!validation.allowed && validation.feedback) {
                issues[node.taskId] = validation.feedback.detail || validation.feedback.title;
            }
        });
        return issues;
    }, [flowDocument]);
    const branchLabel = repoStatus?.gitInitialized ? repoStatus.branch ?? 'main' : '未初始化';

    const refreshRepoStatus = useCallback(async () => {
        if (!groupId) return;
        setRepoLoading(true);
        try {
            setRepoStatus(await getOfflineRepoStatus(groupId));
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '仓库状态读取失败',
                detail: getErrorMessage(error, '暂时无法读取本地仓库状态。'),
            });
        } finally {
            setRepoLoading(false);
        }
    }, [groupId, showFeedback]);

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
        setScheduleLoading(true);
        try {
            const nextSchedule = await getOfflineSchedule(groupId, path);
            setSchedule(nextSchedule);
            setScheduleCron(nextSchedule.cron);
            setScheduleTimezone(nextSchedule.timezone ?? defaultTimezone);
        } catch (error) {
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
            setScheduleLoading(false);
        }
    }, [defaultTimezone, groupId, showFeedback]);

    const applyFlowDocumentPayload = useCallback((
        path: string,
        payload: OfflineFlowDocument,
        options?: { preferDraft?: boolean; silentDraftRestore?: boolean }
    ) => {
        const payloadSignature = buildFlowDocumentSignature(payload);
        const preferDraft = options?.preferDraft ?? true;
        const draft = groupId && preferDraft ? readDraft(groupId, path) : null;
        let nextDocument = cloneFlowDocument(payload);
        let nextSelectedNodeId = resolveSelectedNodeId(nextDocument, null);
        let nextSelectedTaskIds: string[] = [];

        if (draft) {
            if (draft.savedAt > payload.documentUpdatedAt) {
                nextDocument = cloneFlowDocument(draft.document);
                nextSelectedNodeId = resolveSelectedNodeId(nextDocument, draft.selectedNodeId);
                nextSelectedTaskIds = resolveSelectedTaskIds(nextDocument, draft.selectedTaskIds);
                setStaleDraft(null);
            } else if (buildFlowDocumentSignature(draft.document) !== payloadSignature) {
                setStaleDraft(draft);
            } else {
                nextSelectedNodeId = resolveSelectedNodeId(nextDocument, draft.selectedNodeId);
                nextSelectedTaskIds = resolveSelectedTaskIds(nextDocument, draft.selectedTaskIds);
                setStaleDraft(null);
            }
        } else {
            setStaleDraft(null);
        }

        setActiveFlowPath(path);
        setFlowDocument(nextDocument);
        setOriginalDocumentSignature(payloadSignature);
        setActiveNodeId(resolveSelectedNodeId(nextDocument, nextSelectedNodeId));
        setSelectedTaskIds(resolveSelectedTaskIds(nextDocument, nextSelectedTaskIds));
    }, [groupId]);

    const openFlowDocument = useCallback(async (pathValue: string, options?: { preferDraft?: boolean; silentDraftRestore?: boolean }) => {
        if (!groupId) return;
        const normalizedPath = pathValue.trim();
        if (!normalizedPath) {
            return;
        }

        setFlowLoading(true);
        try {
            const payload = await getOfflineFlowDocument(groupId, normalizedPath);
            applyFlowDocumentPayload(normalizedPath, payload, options);
            await loadScheduleSnapshot(normalizedPath);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: 'Flow 打开失败',
                detail: getErrorMessage(error, '请检查路径是否存在，或稍后再试。'),
            });
        } finally {
            setFlowLoading(false);
        }
    }, [applyFlowDocumentPayload, groupId, loadScheduleSnapshot, showFeedback]);

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
        const invalidNode = findFirstSqlNodeMissingDataSource(flowDocument);
        if (invalidNode) {
            const validation = validateSqlNodeDataSourceRequirement({
                kind: invalidNode.kind,
                dataSourceId: invalidNode.dataSourceId,
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
            // If the deleted flow is the currently open one, reset the canvas
            if (activeFlowPath === deleteFlowPath) {
                setActiveFlowPath(null);
                setFlowDocument(null);
                setOriginalDocumentSignature('');
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
            // Update the path reference if this was the active flow
            const oldPath = renameFlowPath;
            const parts = oldPath.split('/');
            const newPath = parts.length >= 2 ? `_flows/${newName}/flow.yaml` : oldPath;
            if (activeFlowPath === oldPath) {
                setActiveFlowPath(newPath);
            }
            showFeedback({ tone: 'success', title: 'Flow 已重命名', detail: `${renameFlowOriginalName} → ${newName}` });
            await refreshRepoTree();
            if (activeFlowPath === newPath || activeFlowPath === oldPath) {
                await openFlowDocument(newPath !== oldPath ? newPath : oldPath);
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
    }, [groupId, renameFlowPath, renameFlowName, renameFlowOriginalName, activeFlowPath, showFeedback, refreshRepoTree, openFlowDocument]);

    const handleDeleteFolder = useCallback(async () => {
        if (!groupId || !deleteFolderPath) return;
        setDeleteFolderLoading(true);
        try {
            await deleteOfflineFolder(groupId, deleteFolderPath);
            setDeleteFolderDialogOpen(false);
            // If the active flow was inside this folder, clear it
            if (activeFlowPath && activeFlowPath.startsWith(deleteFolderPath + '/')) {
                setActiveFlowPath(null);
                setFlowDocument(null);
                setOriginalDocumentSignature('');
            }
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
    }, [groupId, deleteFolderPath, deleteFolderName, activeFlowPath, showFeedback, refreshRepoTree]);

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

            // If active flow was inside this folder, update its path
            if (activeFlowPath && activeFlowPath.startsWith(oldPath + '/')) {
                const refreshedPath = activeFlowPath.replace(oldPath, newPath);
                setActiveFlowPath(refreshedPath);
                await openFlowDocument(refreshedPath);
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
    }, [groupId, renameFolderPath, renameFolderName, renameFolderOriginalName, activeFlowPath, showFeedback, refreshRepoTree, openFlowDocument]);

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

    const persistDraft = useCallback((
        path: string,
        document: OfflineFlowDocument,
        originalSignature: string,
        selectedNodeId: string | null,
        taskIds: string[]
    ) => {
        if (!groupId) return;
        writeDraft(groupId, path, {
            document: cloneFlowDocument(document),
            savedAt: Date.now(),
            documentUpdatedAt: document.documentUpdatedAt,
            originalSignature,
            selectedNodeId,
            selectedTaskIds: taskIds,
        });
    }, [groupId]);


    const loadExecutionArtifacts = useCallback(async (executionId: string, taskId?: string | null) => {
        if (!groupId) return;
        setExecutionDetailLoading(true);
        try {
            const [detail, logs] = await Promise.all([
                getOfflineExecution(groupId, executionId),
                getOfflineExecutionLogs(groupId, executionId, taskId),
            ]);
            setActiveExecutionId(executionId);
            setExecutionDetail(detail);
            setExecutionLogs(logs);
            setLogTaskFilter(taskId ?? null);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '执行详情读取失败',
                detail: getErrorMessage(error, '暂时无法读取执行详情或日志。'),
            });
        } finally {
            setExecutionDetailLoading(false);
        }
    }, [groupId, showFeedback]);

    const refreshExecutions = useCallback(async (preferExecutionId?: string | null) => {
        if (!groupId || !activeFlowPath) return;
        setExecutionsLoading(true);
        try {
            const nextExecutions = await listOfflineExecutions(groupId, activeFlowPath);
            setExecutions(nextExecutions);
            const fallbackId = preferExecutionId && nextExecutions.some((item) => item.executionId === preferExecutionId)
                ? preferExecutionId
                : nextExecutions[0]?.executionId ?? null;
            if (fallbackId) {
                await loadExecutionArtifacts(fallbackId, logTaskFilter);
            } else {
                setActiveExecutionId(null);
                setExecutionDetail(null);
                setExecutionLogs([]);
                setLogTaskFilter(null);
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
    }, [activeFlowPath, groupId, loadExecutionArtifacts, logTaskFilter, showFeedback]);

    useEffect(() => {
        // Reset active flow states when switching groups
        setActiveFlowPath(null);
        setFlowDocument(null);
        setActiveNodeId(null);
        setSelectedTaskIds([]);
        setStaleDraft(null);
        setOriginalDocumentSignature('');

        if (!groupId) return;
        void refreshWorkspace();
    }, [groupId, refreshWorkspace]);

    useEffect(() => {
        if (!groupId || !activeFlowPath || !flowDocument || !isDirty) return;
        const timer = window.setTimeout(() => {
            persistDraft(activeFlowPath, flowDocument, originalDocumentSignature, activeNodeId, selectedTaskIds);
        }, 5000);
        return () => window.clearTimeout(timer);
    }, [activeFlowPath, activeNodeId, flowDocument, groupId, isDirty, originalDocumentSignature, persistDraft, selectedTaskIds]);

    useEffect(() => {
        if (!groupId || !activeFlowPath || !flowDocument) return;
        const handleBeforeUnload = () => {
            if (buildFlowDocumentSignature(flowDocument) !== originalDocumentSignature) {
                persistDraft(activeFlowPath, flowDocument, originalDocumentSignature, activeNodeId, selectedTaskIds);
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [activeFlowPath, activeNodeId, flowDocument, groupId, originalDocumentSignature, persistDraft, selectedTaskIds]);

    useEffect(() => {
        if (!executionDialogOpen || !activeFlowPath) return;
        void refreshExecutions(null);
    }, [activeFlowPath, executionDialogOpen, refreshExecutions]);

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

    const handleEditorBeforeMount = useCallback((monaco: typeof Monaco) => {
        registerEditorThemes(monaco);
    }, []);

    const handleToggleTaskSelection = useCallback((taskId: string) => {
        setSelectedTaskIds((current) => current.includes(taskId)
            ? current.filter((item) => item !== taskId)
            : [...current, taskId]);
    }, []);

    const handleToggleTreeNode = useCallback((nodeId: string) => {
        setExpandedTreeIds((current) => current.includes(nodeId)
            ? current.filter((item) => item !== nodeId)
            : [...current, nodeId]);
    }, []);

    const handleOpenNodeEditor = useCallback((taskId: string) => {
        const node = flattenDocumentNodes(flowDocument).find((n) => n.taskId === taskId);
        if (!node) return;
        setActiveNodeId(taskId);
        setNodeEditorContent(node.scriptContent);
        setNodeEditorOpen(true);
    }, [flowDocument]);

    const handleNodeEditorSave = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
        if (!activeNodeId || !flowDocument) return;
        const activeEditingNode = flattenDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
        const validation = validateSqlNodeDataSourceRequirement({
            kind: activeEditingNode?.kind ?? 'SHELL',
            dataSourceId,
            strict: false,
        });
        setFlowDocument((current) => {
            if (!current) return current;
            return {
                ...current,
                stages: current.stages.map((stage) => ({
                    ...stage,
                    nodes: stage.nodes.map((node) =>
                        node.taskId === activeNodeId 
                          ? { ...node, scriptContent: content, dataSourceId, dataSourceType } 
                          : node,
                    ),
                })),
            };
        });
        if (validation.feedback) {
            showFeedback(validation.feedback);
        }
        setNodeEditorOpen(false);
    }, [activeNodeId, flowDocument, showFeedback]);

    const handleNodeEditorTempSave = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
        if (!activeNodeId || !flowDocument) return;
        const activeEditingNode = flattenDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
        const validation = validateSqlNodeDataSourceRequirement({
            kind: activeEditingNode?.kind ?? 'SHELL',
            dataSourceId,
            strict: false,
        });
        setFlowDocument((current) => {
            if (!current) return current;
            return {
                ...current,
                stages: current.stages.map((stage) => ({
                    ...stage,
                    nodes: stage.nodes.map((node) =>
                        node.taskId === activeNodeId 
                          ? { ...node, scriptContent: content, dataSourceId, dataSourceType } 
                          : node,
                    ),
                })),
            };
        });
        showFeedback(validation.feedback ?? { tone: 'success', title: '暂存成功', detail: '已更新至内存，尚未落盘保存。' });
    }, [activeNodeId, flowDocument, showFeedback]);

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

        setFlowDocument(current => {
            if (!current) return current;
            
            // 1. Update stages/nodes and scriptPath
            const nextStages = current.stages.map(stage => ({
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

            // 2. Update edges
            const nextEdges = (current.edges || []).map(edge => {
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

            // 3. Update layout keys
            const nextLayout = { ...(current.layout || {}) };
            if (nextLayout[oldId]) {
                nextLayout[cleanNewId] = nextLayout[oldId];
                delete nextLayout[oldId];
            }

            return {
                ...current,
                stages: nextStages,
                edges: nextEdges,
                layout: nextLayout
            };
        });

        // 4. Update UI selections
        if (activeNodeId === oldId) {
            setActiveNodeId(cleanNewId);
        }
        setSelectedTaskIds(currIds => currIds.map(id => id === oldId ? cleanNewId : id));

    }, [activeNodeId, flowDocument, setSelectedTaskIds, showFeedback]);

    const handleAddCanvasNode = useCallback((kind: 'SQL' | 'SHELL', position: { x: number; y: number }) => {
        if (!flowDocument) return;

        const existingIds = new Set(flattenDocumentNodes(flowDocument).map((n) => n.taskId));
        let index = 1;
        let newTaskId = `${kind.toLowerCase()}_node_${index}`;
        while (existingIds.has(newTaskId)) {
            index++;
            newTaskId = `${kind.toLowerCase()}_node_${index}`;
        }

        const ext = kind === 'SQL' ? 'sql' : 'sh';
        const flowDir = flowDocument.path.replace('/flow.yaml', '');
        const scriptPath = `${flowDir.replace(/^_flows\//, 'scripts/')}/${newTaskId}.${ext}`;

        const newNode: OfflineFlowNode = {
            taskId: newTaskId,
            kind,
            scriptPath,
            scriptContent: kind === 'SQL' ? '-- Write your SQL query here\nSELECT 1;\n' : '#!/bin/bash\necho "Hello World"\n',
        };

        setFlowDocument((current) => {
            if (!current) return current;
            const updatedStages = [...current.stages];
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

            return {
                ...current,
                stages: updatedStages,
                layout: {
                    ...(current.layout || {}),
                    [newTaskId]: position,
                },
            };
        });

        setActiveNodeId(newTaskId);
        setSelectedTaskIds([newTaskId]);
    }, [flowDocument]);

    const handleCanvasNodesChange = useCallback((nodes: Node[]) => {
        const previousNodeIds = new Set(canvasNodesRef.current.map((node) => node.id));
        const nextNodeIds = new Set(nodes.map((node) => node.id));
        canvasNodesRef.current = nodes;
        if (!flowDocument) return;

        const nodeSetChanged = previousNodeIds.size !== nextNodeIds.size
            || Array.from(previousNodeIds).some((nodeId) => !nextNodeIds.has(nodeId));
        if (!nodeSetChanged) {
            return;
        }

        const nextDocument = applyCanvasStateToDocument(flowDocument, nodes, canvasEdgesRef.current);
        setFlowDocument(nextDocument);
        setActiveNodeId((current) => resolveSelectedNodeId(nextDocument, current));
        setSelectedTaskIds((current) => resolveSelectedTaskIds(nextDocument, current));
    }, [flowDocument]);

    const handleCanvasEdgesChange = useCallback((edges: Edge[]) => {
        const nextEdges = buildEdgesFromCanvasEdges(edges);
        canvasEdgesRef.current = edges;
        setFlowDocument((current) => {
            if (!current) return current;
            if (JSON.stringify(current.edges) === JSON.stringify(nextEdges)) {
                return current;
            }
            return {
                ...current,
                edges: nextEdges,
            };
        });
    }, []);

    const handleCanvasNodeLayoutCommit = useCallback((nodes: Node[]) => {
        const nextLayout = buildLayoutFromCanvasNodes(nodes);
        canvasNodesRef.current = nodes;
        setFlowDocument((current) => {
            if (!current) return current;
            if (JSON.stringify(current.layout) === JSON.stringify(nextLayout)) {
                return current;
            }
            return {
                ...current,
                layout: nextLayout,
            };
        });
    }, []);

    const validateDocumentForAction = useCallback((nodeOverride?: { taskId: string; content: string; dataSourceId?: number; dataSourceType?: string }) => {
        if (!flowDocument) return true;
        
        const invalidNode = findFirstSqlNodeMissingDataSource(flowDocument, nodeOverride);
        if (invalidNode) {
            const validation = validateSqlNodeDataSourceRequirement({
                kind: invalidNode.kind,
                dataSourceId: invalidNode.dataSourceId,
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

    const handleSaveFlow = useCallback(async (nodeOverride?: { taskId: string; content: string; dataSourceId?: number; dataSourceType?: string }) => {
        if (!groupId || !activeFlowPath || !flowDocument) return;
        
        if (!validateDocumentForAction(nodeOverride)) {
            return;
        }
        setSavingFlow(true);
        try {
            const currentEdges = canvasEdgesRef.current;
            const currentNodes = canvasNodesRef.current;
            const draftDocument = applyCanvasStateToDocument(flowDocument, currentNodes, currentEdges);
            
            if (nodeOverride) {
                draftDocument.stages.forEach(stage => {
                    stage.nodes.forEach(node => {
                        if (node.taskId === nodeOverride.taskId) {
                            node.scriptContent = nodeOverride.content;
                            node.dataSourceId = nodeOverride.dataSourceId;
                            node.dataSourceType = nodeOverride.dataSourceType;
                        }
                    });
                });
            }

            const response = await saveOfflineFlowDocument({
                groupId,
                path: activeFlowPath,
                documentHash: flowDocument.documentHash,
                documentUpdatedAt: flowDocument.documentUpdatedAt,
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
            const nextDocument = cloneFlowDocument(response);
            const nextSignature = buildFlowDocumentSignature(response);
            const nextSelectedNodeId = resolveSelectedNodeId(nextDocument, activeNodeId);
            const nextSelectedTaskIds = resolveSelectedTaskIds(nextDocument, selectedTaskIds);
            setFlowDocument(nextDocument);
            setOriginalDocumentSignature(nextSignature);
            setActiveNodeId(nextSelectedNodeId);
            setSelectedTaskIds(nextSelectedTaskIds);
            persistDraft(activeFlowPath, nextDocument, nextSignature, nextSelectedNodeId, nextSelectedTaskIds);
            await refreshRepoStatus();
            showFeedback({
                tone: 'success',
                title: 'Flow 已保存',
                detail: '节点内容、依赖关系和布局已写回本地仓库。',
            });
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 409 && groupId && activeFlowPath && flowDocument) {
                persistDraft(activeFlowPath, flowDocument, originalDocumentSignature, activeNodeId, selectedTaskIds);
                const latest = await getOfflineFlowDocument(groupId, activeFlowPath);
                applyFlowDocumentPayload(activeFlowPath, latest, { preferDraft: false, silentDraftRestore: true });
                setStaleDraft(readDraft(groupId, activeFlowPath));
                await loadScheduleSnapshot(activeFlowPath);
            }
            showFeedback({
                tone: 'error',
                title: '保存失败',
                detail: getErrorMessage(error, '本地脚本文件保存失败，请稍后重试。'),
            });
        } finally {
            setSavingFlow(false);
        }
    }, [
        activeFlowPath,
        activeNodeId,
        applyFlowDocumentPayload,
        flowDocument,
        groupId,
        loadScheduleSnapshot,
        originalDocumentSignature,
        persistDraft,
        refreshRepoStatus,
        selectedTaskIds,
        showFeedback,
    ]);

    const handleNodeEditorSaveToDisk = useCallback(async (content: string, dataSourceId?: number, dataSourceType?: string) => {
        if (!activeNodeId) return;
        const activeEditingNode = flattenDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
        const validation = validateSqlNodeDataSourceRequirement({
            kind: activeEditingNode?.kind ?? 'SHELL',
            dataSourceId,
            strict: true,
        });
        if (!validation.allowed && validation.feedback) {
            showFeedback(validation.feedback);
            return;
        }
        handleNodeEditorTempSave(content, dataSourceId, dataSourceType);
        await handleSaveFlow({ taskId: activeNodeId, content, dataSourceId, dataSourceType });
    }, [activeNodeId, flowDocument, handleNodeEditorTempSave, handleSaveFlow, showFeedback]);

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
                await handleSaveFlow();
                // After successful save, refresh repo status to ensure 'dirty' flag is picked up by backend if needed
                await refreshRepoStatus();
            } catch (error) {
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
        if (!groupId || !activeFlowPath) return;
        if (isDirty) {
            showFeedback({
                tone: 'error',
                title: '请先保存当前修改',
                detail: '调试执行只会读取已经保存到本地仓库的节点内容。',
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
            const response = await createOfflineSavedDebugExecution({
                groupId,
                flowPath: activeFlowPath,
                selectedTaskIds,
                mode: 'SELECTED',
            });
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
    }, [activeFlowPath, groupId, isDirty, refreshExecutions, selectedTaskIds, showFeedback]);

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
            await openFlowDocument(activeFlowPath, { preferDraft: false, silentDraftRestore: true });
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
            await openFlowDocument(activeFlowPath, { preferDraft: false, silentDraftRestore: true });
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
        const restoredDocument = cloneFlowDocument(staleDraft.document);
        setFlowDocument(restoredDocument);
        setActiveNodeId(resolveSelectedNodeId(restoredDocument, staleDraft.selectedNodeId));
        setSelectedTaskIds(resolveSelectedTaskIds(restoredDocument, staleDraft.selectedTaskIds));
        setStaleDraft(null);
        showFeedback({
            tone: 'info',
            title: '已恢复旧草稿',
            detail: '你当前看到的是本地草稿内容；保存时会覆盖当前仓库版本的脚本内容。',
        });
    }, [showFeedback, staleDraft]);

    const handleDiscardStaleDraft = useCallback(() => {
        if (!groupId || !activeFlowPath) return;
        clearDraft(groupId, activeFlowPath);
        setStaleDraft(null);
        showFeedback({
            tone: 'info',
            title: '已丢弃本地草稿',
            detail: '工作台将继续使用当前本地文件版本。',
        });
    }, [activeFlowPath, groupId, showFeedback]);

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
                                                setSelectedTaskIds(flattenDocumentNodes(flowDocument).map((n) => n.taskId));
                                            } else {
                                                setSelectedTaskIds([]);
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
                                                disabled={!activeFlowPath || !canWrite || isDirty}
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
                                            <strong>检测到本地草稿基于旧版本</strong>
                                            <p>当前已加载最新文件。你可以恢复旧草稿继续编辑，也可以丢弃草稿保持最新内容。</p>
                                        </div>
                                    </div>
                                    <div className="offline-conflict-actions">
                                        <Button type="button" variant="outline" size="sm" onClick={handleDiscardStaleDraft}>
                                            加载最新
                                        </Button>
                                        <Button type="button" size="sm" onClick={handleRestoreStaleDraft}>
                                            保持本地草稿
                                        </Button>
                                    </div>
                                </section>
                            ) : null}

                            <section className="offline-canvas-board" ref={canvasBoardRef}>
                                <ReactFlowProvider>
                                    <FlowCanvas
                                        flowDocument={flowDocument}
                                        selectedTaskIds={selectedTaskIds}
                                        activeNodeId={activeNodeId}
                                        nodeIssues={nodeIssues}
                                        onNodesChange={handleCanvasNodesChange}
                                        onEdgesChange={handleCanvasEdgesChange}
                                        onNodeLayoutCommit={handleCanvasNodeLayoutCommit}
                                        onSelectNode={setActiveNodeId}
                                        onToggleTaskSelection={handleToggleTaskSelection}
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

            <ExecutionDialog
                open={executionDialogOpen}
                flowPath={activeFlowPath}
                executions={executions}
                loading={executionsLoading}
                detail={executionDetail}
                detailLoading={executionDetailLoading}
                logs={executionLogs}
                logTaskFilter={logTaskFilter}
                activeExecutionId={activeExecutionId}
                actionPending={executionActionPending}
                onOpenChange={(open) => setExecutionDialogOpen(open)}
                onRefresh={() => void refreshExecutions(activeExecutionId)}
                onSelectExecution={(executionId, taskId) => void loadExecutionArtifacts(executionId, taskId)}
                onStopExecution={(executionId) => void handleStopExecution(executionId)}
                onStopAll={() => void handleStopAllExecutions()}
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
                onOpenChange={setNodeEditorOpen}
                onSave={handleNodeEditorSave}
                onTempSave={handleNodeEditorTempSave}
                onSaveToDisk={handleNodeEditorSaveToDisk}
                onContentChange={setNodeEditorContent}
                handleEditorBeforeMount={handleEditorBeforeMount}
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

const LazyEditor = lazy(loadQueryEditorModule);

interface NodeEditorDialogProps {
    open: boolean;
    activeNode: OfflineFlowNode | null;
    groupId: number | null;
    content: string;
    onOpenChange: (open: boolean) => void;
    onSave: (content: string, dataSourceId?: number, dataSourceType?: string) => void;
    onTempSave: (content: string, dataSourceId?: number, dataSourceType?: string) => void;
    onSaveToDisk: (content: string, dataSourceId?: number, dataSourceType?: string) => Promise<void>;
    onContentChange: (content: string) => void;
    handleEditorBeforeMount: (monaco: typeof Monaco) => void;
}

function NodeEditorDialog({ 
    open, 
    activeNode, 
    groupId,
    content, 
    onOpenChange, 
    onSave, 
    onTempSave, 
    onSaveToDisk, 
    onContentChange, 
    handleEditorBeforeMount 
}: NodeEditorDialogProps) {
    const [confirmClose, setConfirmClose] = useState(false);
    const {
        currentDataSourceId,
        selectedDataSource,
        options: dataSourceOptions,
        loading: dataSourcesLoading,
        loadingMore: dataSourcesLoadingMore,
        hasMore: dataSourcesHasMore,
        handleSearchKeywordChange,
        loadMore: loadMoreDataSources,
        setCurrentDataSourceId,
    } = useNodeEditorDataSources({
        open,
        kind: activeNode?.kind ?? 'SHELL',
        groupId,
        initialDataSourceId: activeNode?.dataSourceId,
    });
    const dataSourceSelectOptions = useMemo(() => buildNodeEditorDataSourceOptions(dataSourceOptions), [dataSourceOptions]);

    useEffect(() => {
        if (open) {
            setConfirmClose(false);
        }
    }, [open]);

    if (!activeNode) return null;
    const language = activeNode.kind === 'SQL' ? 'sql' : 'shell';
    const hasCodeChanges = activeNode.scriptContent !== content;
    const hasDSChanges = activeNode.dataSourceId !== currentDataSourceId;
    const hasUnsavedChanges = hasCodeChanges || hasDSChanges;
    const currentDS = selectedDataSource;

    const handleAttemptClose = () => {
        if (hasUnsavedChanges) {
            setConfirmClose(true);
        } else {
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) handleAttemptClose(); }}>
            <DialogPortal>
                <DialogOverlay className="fixed inset-0 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" style={{ zIndex: 1050 }} />
                <DialogContent 
                    className="fixed inset-0 flex flex-col bg-white max-h-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100" 
                    style={{ zIndex: 1050 }}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    <div className="flex items-center justify-between border-b px-4 py-2 bg-[#fdfcfb] shadow-sm z-10">
                        <div className="flex items-center gap-5">
                            {/* Identity Section */}
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border",
                                    activeNode.kind === 'SQL' 
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                                        : "bg-gray-100 text-gray-600 border-gray-200"
                                )}>
                                    {activeNode.kind}
                                </div>
                                <DialogTitle className="text-sm font-mono font-medium text-gray-600">
                                    {activeNode.taskId}
                                </DialogTitle>
                                <DialogDescription className="sr-only">
                                    {activeNode.kind === 'SQL' ? 'SQL 节点' : 'Shell 节点'}: {activeNode.taskId}
                                </DialogDescription>
                            </div>

                            <div className="h-4 w-[1px] bg-gray-200" />

                            {/* Config Section */}
                            {activeNode.kind === 'SQL' && (
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5 text-gray-500">
                                        <Database size={14} strokeWidth={2.5} />
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">数据源</span>
                                    </div>
                                    <div className="min-w-[260px]">
                                        <OfflineDataSourcePicker
                                            options={dataSourceSelectOptions}
                                            selectedOption={currentDS ? {
                                                label: currentDS.name,
                                                value: String(currentDS.id),
                                                type: currentDS.type,
                                                raw: currentDS,
                                            } : null}
                                            onSelect={(option) => {
                                                setCurrentDataSourceId(Number(option.value));
                                            }}
                                            onSearch={handleSearchKeywordChange}
                                            loading={dataSourcesLoading}
                                            loadingMore={dataSourcesLoadingMore}
                                            hasMore={dataSourcesHasMore}
                                            onLoadMore={loadMoreDataSources}
                                            placeholder="选择数据源..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <TooltipProvider delayDuration={300}>
                            <div className="flex items-center gap-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="p-1.5 rounded hover:bg-white hover:shadow-sm text-gray-500 hover:text-indigo-600 transition-all active:scale-95"
                                            aria-label="应用暂存"
                                            onClick={() => onTempSave(content, currentDataSourceId, currentDS?.type)}
                                        >
                                            <Inbox size={18} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content z-[2100]" side="bottom">
                                        应用并将改动暂存至内存
                                    </TooltipContent>
                                </Tooltip>

                                <div className="w-[1px] h-4 bg-gray-200 mx-1" />

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="p-1.5 rounded hover:bg-white hover:shadow-sm text-gray-400 hover:text-red-500 transition-all active:scale-95"
                                            aria-label="关闭"
                                            onClick={handleAttemptClose}
                                        >
                                            <X size={20} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content z-[2100]" side="bottom">
                                        关闭
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                        </TooltipProvider>
                    </div>
                    <div className="flex-1 min-h-0 relative">
                        <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">编辑器加载中...</div>}>
                            <LazyEditor
                                height="100%"
                                width="100%"
                                beforeMount={handleEditorBeforeMount}
                                language={language}
                                theme="warm-parchment"
                                value={content}
                                onChange={(value: string | undefined) => onContentChange(value ?? '')}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 14,
                                    lineNumbers: 'on',
                                    lineNumbersMinChars: 3,
                                    wordWrap: 'on',
                                    automaticLayout: true,
                                    scrollBeyondLastLine: false,
                                    tabSize: 2,
                                    padding: { top: 14, bottom: 14 },
                                }}
                            />
                        </Suspense>

                        {/* 未保存提醒的遮挡层（模态悬浮卡片） */}
                        {confirmClose && (
                            <div className="absolute inset-0 bg-black/10 backdrop-blur-[2px] z-50 flex flex-col items-center justify-center p-6 rounded-b-lg">
                                <div className="bg-white shadow-2xl border border-gray-100 rounded-xl p-6 max-w-[420px] w-full animate-in zoom-in-95 fade-in-0 duration-200">
                                    <div className="flex items-start gap-4 mb-6">
                                        <div className="p-3 bg-amber-50 text-amber-600 rounded-full shrink-0">
                                            <AlertTriangle size={24} strokeWidth={2.5} />
                                        </div>
                                        <div className="pt-1">
                                            <h3 className="text-[1.1rem] font-semibold text-gray-900 mb-1.5">是否保存修改？</h3>
                                            <p className="text-[0.9rem] text-gray-500 leading-relaxed">
                                                你在 <strong>{activeNode.taskId}</strong> 节点修改了内容。如果不暂存，这些更改将会丢失。
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-end gap-2.5 mt-2">
                                        <Button 
                                            variant="outline" 
                                            onClick={() => onOpenChange(false)} 
                                            className="text-red-500 hover:text-red-600 hover:bg-red-50 border-transparent"
                                        >
                                            直接退出
                                        </Button>
                                        <div className="flex-1" />
                                        <Button variant="outline" onClick={() => setConfirmClose(false)}>
                                            继续编辑
                                        </Button>
                                        <Button variant="default" onClick={() => onSave(content, currentDataSourceId, currentDS?.type)}>
                                            应用修改并关闭
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
