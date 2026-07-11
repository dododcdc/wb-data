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
    LoaderCircle,
    RefreshCcw,
    TerminalSquare,
    X,
    Copy,
} from 'lucide-react';
import {
    getOfflineRepoTree,
    type OfflineExecutionDetail,
    type OfflineExecutionListItem,
    type OfflineFlowNodeKind,
    type OfflineRepoTreeResponse,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
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
import { OfflineWorkbenchSidebar } from './OfflineWorkbenchSidebar';
import { OfflineCanvasToolbar } from './OfflineCanvasToolbar';
import { OfflineTreeActionDialogs } from './OfflineTreeActionDialogs';
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard';
import { useOfflineRepositoryWorkflow } from './useOfflineRepositoryWorkflow';
import { useOfflineTreeMutations } from './useOfflineTreeMutations';
import { useFlowExecutionAndSchedule } from './useFlowExecutionAndSchedule';
import { useFlowEditingSession } from './useFlowEditingSession';
import { useOfflineWorkbenchNavigation } from './useOfflineWorkbenchNavigation';
import {
    useOfflineWorkbenchBeforeUnloadLeave,
    useOfflineWorkbenchBranchEvent,
    useOfflineWorkbenchGroupLifecycle,
    useOfflineWorkbenchNewFlowShortcut,
    useOfflineWorkbenchUrlRestore,
} from './OfflineWorkbenchLifecycle';

import './OfflineWorkbench.css';

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
    const canvasBoardRef = useRef<HTMLDivElement>(null);
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
    const refreshRepoTree = useCallback(async () => {
        if (!groupId) return;
        setTreeLoading(true);
        try {
            const nextTree = await getOfflineRepoTree(groupId);
            setRepoTree(nextTree);
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

    useOfflineWorkbenchGroupLifecycle({
        groupId,
        leaveCurrentFlow,
        resetActiveFlow: resetActiveFlowAfterBranchSwitch,
        resetBranchList,
        resetBranchSwitchState,
        refreshWorkspace,
    });

    useOfflineWorkbenchBranchEvent({
        groupId,
        resetActiveFlow: resetActiveFlowAfterBranchSwitch,
        resetBranchList,
        resetBranchSwitchState,
        refreshWorkspace,
    });

    useOfflineWorkbenchUrlRestore({
        groupId,
        repoTree,
        searchParams,
        openFlowDocument,
    });

    useOfflineWorkbenchBeforeUnloadLeave({
        groupId,
        draftSession,
        leaveCurrentFlow,
    });

    useOfflineWorkbenchNewFlowShortcut({
        newFlowDialogOpen,
        nodeEditorOpen,
        executionDialogOpen,
        scheduleDialogOpen,
        openRootNewFlowDialog,
    });



    const handleToggleTaskSelection = useCallback((taskId: string) => {
        setDraftSelectedTaskIds((current) => current.includes(taskId)
            ? current.filter((item) => item !== taskId)
            : [...current, taskId]);
    }, [setDraftSelectedTaskIds]);

    const handleReplaceTaskSelection = useCallback((taskIds: string[]) => {
        setDraftSelectedTaskIds(resolveFlowSelectedTaskIds(flowDocument, taskIds));
    }, [flowDocument, setDraftSelectedTaskIds]);

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

    const handleSelectAllNodes = useCallback((selected: boolean) => {
        setDraftSelectedTaskIds(selected && flowDocument
            ? flattenFlowDocumentNodes(flowDocument).map((node) => node.taskId)
            : []);
    }, [flowDocument, setDraftSelectedTaskIds]);

    const handleAddNodeAtCanvasCenter = useCallback((kind: OfflineFlowNodeKind) => {
        if (!flowDocument) return;
        const board = canvasBoardRef.current;
        const center = board
            ? {
                x: board.getBoundingClientRect().width / 2,
                y: board.getBoundingClientRect().height / 2,
            }
            : { x: 300, y: 200 };
        addNode(kind, center);
    }, [addNode, flowDocument]);

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
                    <OfflineWorkbenchSidebar
                        isGroupAdmin={isGroupAdmin}
                        branch={{
                            label: branchLabel,
                            canSwitch: canSwitchBranch,
                            menuOpen: branchMenuOpen,
                            tooltipOpen: branchTooltipOpen,
                            loading: branchLoading,
                            switching: branchSwitching,
                            branches,
                            dirtyState: branchDirtyState,
                            onToggleMenu: handleBranchMenuToggle,
                            onMenuOpenChange: setBranchMenuOpen,
                            onTooltipOpenChange: setBranchTooltipOpen,
                            onSwitch: handleBranchSwitchRequest,
                        }}
                        repository={{
                            available: !!groupId,
                            loading: repoLoading,
                            committing,
                            pushLoading,
                            canCommit: canCommitRepo,
                            canPush,
                            dirty: isDirty || !!repoStatus?.dirty,
                            ahead: !!repoStatus?.ahead,
                            onRefresh: () => void refreshWorkspace(),
                            onOpenCommit: handleOpenRepoCommitDialog,
                            onOpenPush: () => setPushDialogOpen(true),
                        }}
                        creation={{
                            canWrite,
                            menuOpen: newItemMenuOpen,
                            onMenuOpenChange: setNewItemMenuOpen,
                            onOpenNewFlow: () => {
                                setNewItemMenuOpen(false);
                                setNewFlowDialogOpen(true);
                            },
                            onOpenNewFolder: () => {
                                setNewItemMenuOpen(false);
                                setNewFolderParentPath('');
                                setNewFolderName('');
                                setNewFolderDialogOpen(true);
                            },
                        }}
                        tree={{
                            data: repoTree,
                            loading: treeLoading,
                            flowLoading,
                            activeFlowPath,
                            onOpenFlow: (path) => void openFlowDocument(path),
                            onContextMenu: handleContextMenu,
                        }}
                    />
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
                                <OfflineCanvasToolbar
                                    activeFlowPath={activeFlowPath}
                                    canWrite={canWrite}
                                    nodeCount={nodeCount}
                                    selectedNodeCount={selectedTaskIds.length}
                                    dirty={isDirty}
                                    saving={savingFlow}
                                    commitDirty={flowCommitDirty}
                                    committing={committing}
                                    onSelectAll={handleSelectAllNodes}
                                    onSave={() => void handleSaveFlow()}
                                    onCommit={handleOpenFlowCommitDialog}
                                    onOpenSchedule={handleOpenScheduleDialog}
                                    onExecute={() => void handleExecute()}
                                    onOpenExecutions={() => setExecutionDialogOpen(true)}
                                    onAddNode={handleAddNodeAtCanvasCenter}
                                />

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

            <OfflineTreeActionDialogs
                repoTree={repoTree}
                canWrite={canWrite}
                createFlow={{
                    open: newFlowDialogOpen,
                    name: newFlowName,
                    parentPath: newFlowParentPath,
                    pending: newFlowCreating,
                    onOpenChange: setNewFlowDialogOpen,
                    onNameChange: setNewFlowName,
                    onParentPathChange: setNewFlowParentPath,
                    onSubmit: () => void handleCreateFlow(),
                }}
                createFolder={{
                    open: newFolderDialogOpen,
                    name: newFolderName,
                    parentPath: newFolderParentPath,
                    pending: newFolderCreating,
                    onOpenChange: setNewFolderDialogOpen,
                    onNameChange: setNewFolderName,
                    onParentPathChange: setNewFolderParentPath,
                    onSubmit: () => void handleCreateFolder(),
                }}
                deleteFlow={{
                    open: deleteFlowDialogOpen,
                    name: deleteFlowName,
                    pending: deleteFlowLoading,
                    onOpenChange: setDeleteFlowDialogOpen,
                    onSubmit: () => void handleDeleteFlow(),
                }}
                deleteFolder={{
                    open: deleteFolderDialogOpen,
                    name: deleteFolderName,
                    pending: deleteFolderLoading,
                    onOpenChange: setDeleteFolderDialogOpen,
                    onSubmit: () => void handleDeleteFolder(),
                }}
                renameFlow={{
                    open: renameFlowDialogOpen,
                    name: renameFlowName,
                    originalName: renameFlowOriginalName,
                    pending: renameFlowLoading,
                    onOpenChange: setRenameFlowDialogOpen,
                    onNameChange: setRenameFlowName,
                    onSubmit: () => void handleRenameFlow(),
                }}
                renameFolder={{
                    open: renameFolderDialogOpen,
                    name: renameFolderName,
                    originalName: renameFolderOriginalName,
                    pending: renameFolderLoading,
                    onOpenChange: setRenameFolderDialogOpen,
                    onNameChange: setRenameFolderName,
                    onSubmit: () => void handleRenameFolder(),
                }}
                contextMenu={{
                    open: contextMenuOpen,
                    position: contextMenuPosition,
                    node: contextMenuNode,
                    onOpenChange: setContextMenuOpen,
                    onOpenNewFlow: openNewFlowDialogFromContext,
                    onOpenNewFolder: openNewFolderDialogFromContext,
                    onOpenRenameFlow: openRenameFlowDialogFromContext,
                    onOpenRenameFolder: openRenameFolderDialogFromContext,
                    onOpenDeleteFlow: openDeleteFlowDialogFromContext,
                    onOpenDeleteFolder: openDeleteFolderDialogFromContext,
                }}
            />

            <UnsavedChangesDialog
                open={pendingNavigation !== null}
                onOpenChange={(open) => { if (!open) handleCancelLeave(); }}
                onSave={() => void handleConfirmLeave('save')}
                onDiscard={() => void handleConfirmLeave('discard')}
            />

        </section>
    );
}
