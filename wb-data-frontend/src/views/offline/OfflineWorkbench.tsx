import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, GitCompare, LoaderCircle, RotateCcw, X } from 'lucide-react';
import '@/components/loading/RouteSkeletons.css';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '../../components/ui/resizable';
import {
    getOfflineRepoTree,
    pushOfflineCurrentFlow,
    rollbackOfflineFlow,
    type FlowParameterBinding,
    type OfflineRepoTreeResponse,
    type OfflineScheduleResponse,
} from '../../api/offline';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useAuthStore } from '../../utils/auth';
import { getErrorMessage } from '../../utils/error';
import { NodeEditorDialog } from './editor/NodeEditorDialog';
import type { TransferConfig } from './transfer/transferTypes';
import type { TransferNodeDraftState } from './transfer/TransferNodeDialog';
import { DependencyAwareScheduleDialog } from './schedule/DependencyAwareScheduleDialog';
import { DependencyDialog } from './schedule/DependencyDialog';
import { FlowParameterDialog } from './schedule/FlowParameterDialog';
import { ScheduleDialog } from './schedule/ScheduleDialog';
import {
    flattenFlowDocumentNodes,
    resolveFlowSelectedTaskIds,
} from './draft/flowDocumentMutations';
import {
    validateSqlNodeDataSourceRequirement,
} from './editor/nodeEditorDataSourceRules';
import { SaveConflictDialog } from './draft/SaveConflictDialog';
import { OfflineCommitDialogs } from './repo/OfflineCommitDialogs';
import { OfflineWorkbenchSidebar } from './OfflineWorkbenchSidebar';
import { OfflineTreeActionDialogs } from './repo/OfflineTreeActionDialogs';
import { OfflineExecutionDialog } from './execution/OfflineExecutionDialog';
import { ExecutionTimeContextDialog } from './execution/ExecutionTimeContextDialog';
import { OfflineRepositoryDialogs } from './repo/OfflineRepositoryDialogs';
import { OfflineVersionHistoryDrawer } from './version/OfflineVersionHistoryDrawer';
import { OfflineVersionCompareDialog, type VersionSelection } from './version/OfflineVersionCompareDialog';
import { buildWorktreeVersionSelection, formatRevisionTag } from './version/versionComparePresentation';
import { OfflineWorkbenchMainPanel } from './OfflineWorkbenchMainPanel';
import { preloadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';
import { useOfflineRepositoryWorkflow } from './repo/useOfflineRepositoryWorkflow';
import { useOfflineTreeMutations } from './repo/useOfflineTreeMutations';
import { indexNodesByTreePath, prependRecentFlowPath, updateRepoTreeFlowStatus } from './repo/repoTreePaths';
import { prefetchNodeEditorDataSources } from './editor/useNodeEditorDataSources';
import { useFlowExecutionAndSchedule } from './execution/useFlowExecutionAndSchedule';
import { useFlowEditingSession } from './draft/useFlowEditingSession';
import { useOfflineWorkbenchNavigation } from './useOfflineWorkbenchNavigation';
import {
    useOfflineWorkbenchBeforeUnloadLeave,
    useOfflineWorkbenchBranchEvent,
    useOfflineWorkbenchGroupLifecycle,
    useOfflineWorkbenchNewFlowShortcut,
    useOfflineWorkbenchUrlRestore,
} from './OfflineWorkbenchLifecycle';
import { updateFlowDependencyDraft, updateFlowParameterBindingDraft } from './draft/flowDraftController';
import { useOnlineFlowSnapshot, type CanvasMode } from './version/useOnlineFlowSnapshot';

import './OfflineWorkbench.css';

const NOOP = () => undefined;

export default function OfflineWorkbench() {
    const [searchParams] = useSearchParams();
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const currentUser = useAuthStore((state) => state.userInfo);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const groupId = currentGroup?.id ?? null;
    const canWrite = systemAdmin || permissions.includes('offline.write');
    const canConfigureParameters = canWrite && (systemAdmin || permissions.includes('parameter.read'));
    const isGroupAdmin = systemAdmin || permissions.includes('group.settings') || currentGroup?.role === 'GROUP_ADMIN';
    const defaultTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
    const { showFeedback, showSuccess, showError } = useOperationFeedback();

    const [repoTree, setRepoTree] = useState<OfflineRepoTreeResponse | null>(null);
    const [treeLoading, setTreeLoading] = useState(false);
    const treeRequestGeneration = useRef(0);
    useEffect(() => {
        const unsubscribe = useAuthStore.subscribe((state, previous) => {
            if (state.currentGroup?.id === previous.currentGroup?.id && state.token === previous.token) return;
            treeRequestGeneration.current += 1;
            setRepoTree(null);
            setTreeLoading(false);
        });
        return () => {
            unsubscribe();
            treeRequestGeneration.current += 1;
        };
    }, []);
    const [flowCommitDialogOpen, setFlowCommitDialogOpen] = useState(false);
    const [flowPushDialogOpen, setFlowPushDialogOpen] = useState(false);
    const [repoCommitDialogOpen, setRepoCommitDialogOpen] = useState(false);
    const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
    const [versionCompare, setVersionCompare] = useState<{ base: VersionSelection; target: VersionSelection; open: boolean } | null>(null);
    const [rollbackTarget, setRollbackTarget] = useState<VersionSelection | null>(null);
    const [rollingBack, setRollingBack] = useState(false);
    const [rollbackNodeIssues, setRollbackNodeIssues] = useState<Record<string, string>>({});
    const [commitMessage, setCommitMessage] = useState('');
    const [committing, setCommitting] = useState(false);
    const [pushingFlow, setPushingFlow] = useState(false);
    const [parameterDialogOpen, setParameterDialogOpen] = useState(false);
    const [dependencyDialogOpen, setDependencyDialogOpen] = useState(false);
    const [canvasMode, setCanvasMode] = useState<CanvasMode>('dev');
    const [onlineActiveNodeId, setOnlineActiveNodeId] = useState<string | null>(null);
    const [onlineNodeEditorOpen, setOnlineNodeEditorOpen] = useState(false);
    const [onlineScheduleDialogOpen, setOnlineScheduleDialogOpen] = useState(false);
    const [onlineDependencyDialogOpen, setOnlineDependencyDialogOpen] = useState(false);
    const [onlineParameterDialogOpen, setOnlineParameterDialogOpen] = useState(false);
    const loadScheduleSnapshotRef = useRef<((path: string) => Promise<void>) | null>(null);
    const resetExecutionAndScheduleRef = useRef<(() => void) | null>(null);
    const refreshRepoStatusRef = useRef<(() => Promise<void>) | null>(null);
    const refreshDeploymentRef = useRef<(() => void) | null>(null);

    const loadScheduleSnapshotBridge = useCallback((path: string) => loadScheduleSnapshotRef.current?.(path) ?? Promise.resolve(), []);
    const resetExecutionAndScheduleBridge = useCallback(() => {
        resetExecutionAndScheduleRef.current?.();
    }, []);
    const refreshRepoStatusBridge = useCallback(() => refreshRepoStatusRef.current?.() ?? Promise.resolve(), []);

    useEffect(() => {
        if (!groupId) return;

        let cancelled = false;
        const timer = window.setTimeout(() => {
            if (cancelled) return;
            void preloadSqlEditorModule().catch(() => undefined);
            void prefetchNodeEditorDataSources(groupId).catch(() => undefined);
        }, 200);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [groupId]);

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
        savingFlow,
        nodeEditorOpen,
        nodeEditorContent,
        flowCommitDirty,
        flowAhead,
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
        applyFlowDocumentPayload,
        leaveCurrentFlow,
        openFlowDocument: openFlowDocumentFromSession,
        resetAfterBranchSwitch,
        openNodeEditor: handleOpenNodeEditor,
        setNodeEditorOpen: handleNodeEditorOpenChange,
        updateNodeEditorContent: handleNodeEditorContentChange,
        stageNodeEditorDraft,
        saveNodeEditorDraft,
        flushDraftNow,
        flushPendingDraftIfDirty,
        validateDocumentForAction,
        draftSaveState,
        draftSavedAt,
        draftSaveError,
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

    const savedDocument = draftSession?.baseDocument;
    useEffect(() => {
        if (!savedDocument || savedDocument.groupId !== groupId) return;
        setRepoTree((current) => {
            if (!current || current.groupId !== groupId) return current;
            const root = updateRepoTreeFlowStatus(current.root, savedDocument);
            const recentFlowPaths = prependRecentFlowPath(current.recentFlowPaths, savedDocument.path);
            return root === current.root && recentFlowPaths === current.recentFlowPaths
                ? current
                : { ...current, root, recentFlowPaths };
        });
    }, [groupId, savedDocument]);

    useEffect(() => {
        setDependencyDialogOpen(false);
        setOnlineActiveNodeId(null);
        setOnlineNodeEditorOpen(false);
        setOnlineScheduleDialogOpen(false);
        setOnlineDependencyDialogOpen(false);
        setOnlineParameterDialogOpen(false);
        setFlowPushDialogOpen(false);
        setRollbackNodeIssues({});
        setRollbackTarget(null);
    }, [groupId, activeFlowPath]);

    useEffect(() => {
        setCanvasMode('dev');
    }, [groupId]);

    const {
        repoStatus,
        remoteStatus,
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
        deploymentConfig,
        confirmedRevision,
        status: onlineStatus,
        snapshot: onlineSnapshot,
        onlineDocument,
        error: onlineError,
        refresh: refreshOnlineSnapshot,
        refreshDeployment,
    } = useOnlineFlowSnapshot({
        groupId,
        branch: repoStatus?.branch ?? null,
        activeFlowPath,
        enabled: canvasMode === 'online',
    });
    refreshDeploymentRef.current = refreshDeployment;

    useEffect(() => {
        if (!groupId || !activeFlowPath) return;
        void refreshFlowCommitStatus();
    }, [activeFlowPath, groupId, refreshFlowCommitStatus, repoStatus?.ahead, repoStatus?.headCommitId]);
    const {
        executionDialogOpen,
        setExecutionDialogOpen,
        openExecutionDialog,
        executionContextDialogOpen,
        setExecutionContextDialogOpen,
        executionTimeRequirement,
        plannedTime,
        setPlannedTime,
        parameterOverrides,
        setParameterOverrides,
        executionSubmitting,
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
        schedulePeriod,
        changeSchedulePeriod,
        scheduleTimezone,
        scheduleSaving,
        refreshExecutions,
        loadExecutionDetail,
        execute: handleExecute,
        confirmExecution: handleConfirmExecution,
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

    const onlineActiveNode = useMemo(() => {
        if (!onlineDocument || !onlineActiveNodeId) return null;
        return flattenFlowDocumentNodes(onlineDocument).find((node) => node.taskId === onlineActiveNodeId) ?? null;
    }, [onlineActiveNodeId, onlineDocument]);

    const onlineNodeContent = useMemo(() => {
        if (!onlineActiveNode) return '';
        if (onlineActiveNode.scriptContent !== undefined) return onlineActiveNode.scriptContent;
        if (onlineActiveNode.scriptPath && onlineSnapshot?.files) {
            const file = onlineSnapshot.files.find((item) => item.path === onlineActiveNode.scriptPath);
            if (file?.content != null) return file.content;
        }
        return '';
    }, [onlineActiveNode, onlineSnapshot]);

    const onlineScheduleResponse: OfflineScheduleResponse | null = useMemo(() => {
        if (!onlineDocument?.schedule || !groupId) return null;
        return {
            groupId,
            path: onlineDocument.path,
            triggerId: 'schedule',
            cron: onlineDocument.schedule.cron,
            timezone: onlineDocument.schedule.timezone,
            enabled: onlineDocument.schedule.enabled,
            period: onlineDocument.schedule.period,
            contentHash: '',
            fileUpdatedAt: 0,
        };
    }, [groupId, onlineDocument]);

    const handleCanvasModeChange = useCallback((nextMode: CanvasMode) => {
        setCanvasMode(nextMode);
        if (nextMode === 'online') {
            setScheduleDialogOpen(false);
            setDependencyDialogOpen(false);
            setParameterDialogOpen(false);
        } else {
            setOnlineScheduleDialogOpen(false);
            setOnlineDependencyDialogOpen(false);
            setOnlineParameterDialogOpen(false);
            setOnlineNodeEditorOpen(false);
        }
    }, [setScheduleDialogOpen]);

    const handleOpenOnlineNodeEditor = useCallback((taskId: string) => {
        setOnlineActiveNodeId(taskId);
        setOnlineNodeEditorOpen(true);
    }, []);

    const activeRollbackIssues = useMemo(() => {
        if (!flowDocument) return {};
        const existingTaskIds = new Set(flattenFlowDocumentNodes(flowDocument).map((node) => node.taskId));
        const active: Record<string, string> = {};
        for (const [taskId, reason] of Object.entries(rollbackNodeIssues)) {
            if (existingTaskIds.has(taskId) && reason) {
                active[taskId] = reason;
            }
        }
        return active;
    }, [flowDocument, rollbackNodeIssues]);

    const nodeIssues = useMemo(() => {
        if (!flowDocument) return {};
        const issues: Record<string, string | null> = {};
        flattenFlowDocumentNodes(flowDocument).forEach(node => {
            if (node.kind === 'TRANSFER' && (node.transferDraftValid === false || (!node.transfer && !node.transferDraft))) {
                issues[node.taskId] = 'Transfer 配置未完成';
                return;
            }
            const validation = validateSqlNodeDataSourceRequirement({
                kind: node.kind,
                dataSourceId: node.dataSourceId,
                dataSourceType: node.dataSourceType,
                strict: true,
            });
            if (!validation.allowed && validation.feedback) {
                issues[node.taskId] = validation.feedback.detail || validation.feedback.title;
                return;
            }
            if (activeRollbackIssues[node.taskId]) {
                issues[node.taskId] = activeRollbackIssues[node.taskId];
            }
        });
        return issues;
    }, [activeRollbackIssues, flowDocument]);

    const nodeStatuses = useMemo(() => {
        if (!executionDetail?.taskRuns) return {};
        const statuses: Record<string, string> = {};
        executionDetail.taskRuns.forEach((run) => {
            statuses[run.taskId] = run.status;
        });
        return statuses;
    }, [executionDetail]);
    const refreshRepoTree = useCallback(async () => {
        const snapshot = useAuthStore.getState();
        if (!groupId || snapshot.currentGroup?.id !== groupId) return;
        const generation = ++treeRequestGeneration.current;
        const isCurrent = () => {
            const state = useAuthStore.getState();
            return treeRequestGeneration.current === generation
                && state.currentGroup?.id === groupId && state.token === snapshot.token;
        };
        setTreeLoading(true);
        try {
            const nextTree = await getOfflineRepoTree(groupId);
            if (isCurrent()) setRepoTree(nextTree);
        } catch (error) {
            if (!isCurrent()) return;
            showError(error, '项目树读取失败', '');
        } finally {
            if (isCurrent()) setTreeLoading(false);
        }
    }, [groupId, showError]);

    const refreshWorkspace = useCallback(async () => {
        await Promise.all([
            refreshRepoStatus(),
            refreshRepoTree(),
            refreshRemoteStatus(),
        ]);
        refreshDeploymentRef.current?.();
    }, [refreshRepoStatus, refreshRepoTree, refreshRemoteStatus]);

    const resetActiveFlowAfterBranchSwitch = useCallback(() => {
        resetAfterBranchSwitch();
    }, [resetAfterBranchSwitch]);

    const {
        openFlowDocument,
    } = useOfflineWorkbenchNavigation({
        groupId,
        draftSession,
        isDirty,
        openFlowDocumentFromSession,
        flushDraft: flushDraftNow,
    });

    const handleBranchSwitchRequest = useCallback((branchName: string) => {
        void (async () => {
            if (isDirty) {
                await flushDraftNow();
            }
            requestBranchSwitch(branchName, {
                afterSwitch: async () => {
                    resetActiveFlowAfterBranchSwitch();
                    await refreshWorkspace();
                },
            });
        })();
    }, [flushDraftNow, isDirty, refreshWorkspace, requestBranchSwitch, resetActiveFlowAfterBranchSwitch]);

    const ensureWorktreeFlushed = useCallback(async (): Promise<boolean> => {
        if (!canWrite) return true;
        return flushPendingDraftIfDirty();
    }, [canWrite, flushPendingDraftIfDirty]);

    const handleCompareVersions = useCallback(async (base: VersionSelection, target: VersionSelection) => {
        if ((base.revision === 'WORKTREE' || target.revision === 'WORKTREE') && !(await ensureWorktreeFlushed())) {
            return;
        }
        setVersionHistoryOpen(false);
        setVersionCompare({ base, target, open: true });
    }, [ensureWorktreeFlushed]);

    const repoTreeNodeIndex = useMemo(
        () => (repoTree ? indexNodesByTreePath(repoTree.root, repoTree.recentFlowPaths) : null),
        [repoTree],
    );
    const resolveTreeNode = useCallback(
        (treePath: string) => repoTreeNodeIndex?.get(treePath) ?? null,
        [repoTreeNodeIndex],
    );

    const {
        newFlowDialogOpen,
        setNewFlowDialogOpen,
        newFlowName,
        setNewFlowName,
        newFlowTimezone,
        setNewFlowTimezone,
        newFlowCrossGroupDependency,
        setNewFlowCrossGroupDependency,
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
        deleteFlowPath,
        deleteFlowLoading,
        deleteFlowError,
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
        handleCopyFlowName,
        handleMoveNode,
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
        defaultTimezone,
        refreshRepoTree: refreshWorkspace,
        openFlowDocument,
        leaveCurrentFlow,
        setActiveFlowPath,
        setDraftSession,
        showFeedback,
        resolveTreeNode,
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
        nodeEditorOpen: nodeEditorOpen || onlineNodeEditorOpen,
        executionDialogOpen,
        executionContextDialogOpen,
        scheduleDialogOpen: scheduleDialogOpen || onlineScheduleDialogOpen,
        parameterDialogOpen: parameterDialogOpen || onlineParameterDialogOpen,
        dependencyDialogOpen: dependencyDialogOpen || onlineDependencyDialogOpen,
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

    const clearRollbackNodeIssue = useCallback((taskId: string) => {
        setRollbackNodeIssues((current) => {
            if (!(taskId in current)) return current;
            const next = { ...current };
            delete next[taskId];
            return next;
        });
    }, []);

    const handleConfirmRollback = useCallback(async () => {
        if (!groupId || !activeFlowPath || !rollbackTarget || rollingBack || savingFlow) return;
        const target = rollbackTarget;
        const targetPath = activeFlowPath;
        const targetGroupId = groupId;
        setRollingBack(true);
        try {
            const response = await rollbackOfflineFlow({
                groupId: targetGroupId,
                path: targetPath,
                revision: target.revision,
                documentHash: draftSession?.baseDocument?.documentHash,
                documentUpdatedAt: draftSession?.baseDocument?.documentUpdatedAt,
            });
            applyFlowDocumentPayload(targetPath, response.document, { preferRecoverySnapshot: false });
            setRollbackNodeIssues(response.nodeIssues ?? {});
            setCanvasMode('dev');
            setRollbackTarget(null);
            setVersionHistoryOpen(false);
            setVersionCompare(null);
            await Promise.all([
                loadScheduleSnapshot(targetPath),
                refreshRepoStatus(),
                refreshFlowCommitStatus(),
            ]);
            const shortSha = target.shortRevision?.trim() || formatRevisionTag(target.revision);
            if (response.warnings?.length) {
                showFeedback({
                    tone: 'info',
                    title: `已回滚到版本 ${shortSha}（含 ${response.warnings.length} 项兼容提示）`,
                    detail: response.warnings.join('；'),
                });
            } else {
                showSuccess(`已回滚到版本 ${shortSha}`, '仅更新当前工作区草稿，确认无误后再提交和推送');
            }
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '版本回滚失败',
                detail: getErrorMessage(error, ''),
            });
        } finally {
            setRollingBack(false);
        }
    }, [
        activeFlowPath,
        applyFlowDocumentPayload,
        draftSession?.baseDocument?.documentHash,
        draftSession?.baseDocument?.documentUpdatedAt,
        groupId,
        loadScheduleSnapshot,
        refreshFlowCommitStatus,
        refreshRepoStatus,
        rollbackTarget,
        rollingBack,
        savingFlow,
        showFeedback,
        showSuccess,
    ]);

    const handleCompareRollbackWithWorktree = useCallback(() => {
        if (!rollbackTarget) return;
        const target = rollbackTarget;
        setRollbackTarget(null);
        void handleCompareVersions(target, buildWorktreeVersionSelection({ dirty: isDirty || flowCommitDirty }));
    }, [flowCommitDirty, handleCompareVersions, isDirty, rollbackTarget]);

    const handleNodeEditorTempSave = useCallback((
        content: string,
        dataSourceId?: number,
        dataSourceType?: string,
        hiveConf?: Record<string, string>,
    ) => {
        if (!activeNodeId) return;
        saveNodeEditorDraft(content, dataSourceId, dataSourceType, hiveConf);
        clearRollbackNodeIssue(activeNodeId);
        const activeEditingNode = flattenFlowDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null;
        const validation = validateSqlNodeDataSourceRequirement({
            kind: activeEditingNode?.kind ?? 'SHELL',
            dataSourceId,
            dataSourceType,
            strict: false,
        });
        showFeedback(validation.feedback ?? {
            tone: 'success',
            title: '草稿已暂存',
            detail: '自动保存后生效',
        });
    }, [activeNodeId, clearRollbackNodeIssue, flowDocument, saveNodeEditorDraft, showFeedback]);

    const handleNodeEditorDraftChange = useCallback((
        content: string,
        dataSourceId?: number,
        dataSourceType?: string,
        hiveConf?: Record<string, string>,
    ) => {
        stageNodeEditorDraft(
            content,
            dataSourceId,
            dataSourceType,
            undefined,
            undefined,
            undefined,
            hiveConf,
        );
    }, [stageNodeEditorDraft]);

    const handleTransferNodeDraftChange = useCallback((transferDraft: TransferConfig, state: TransferNodeDraftState) => {
        stageNodeEditorDraft(
            nodeEditorContent,
            undefined,
            undefined,
            state.valid ? transferDraft : undefined,
            transferDraft,
            state.valid,
        );
        if (state.valid && activeNodeId) {
            clearRollbackNodeIssue(activeNodeId);
        }
    }, [activeNodeId, clearRollbackNodeIssue, nodeEditorContent, stageNodeEditorDraft]);

    const handleConfirmPushCurrentFlow = useCallback(async () => {
        if (!groupId || !activeFlowPath || pushingFlow) return;
        const targetGroupId = groupId;
        const targetFlowPath = activeFlowPath;
        setPushingFlow(true);
        try {
            const result = await pushOfflineCurrentFlow(targetGroupId, targetFlowPath);
            if (result.success) {
                setFlowPushDialogOpen(false);
                showFeedback({
                    tone: 'success',
                    title: '当前任务推送成功',
                    detail: result.message && result.message !== '当前任务推送成功' ? result.message : '',
                });
                await Promise.all([
                    refreshRemoteStatus(),
                    refreshRepoStatus(),
                    refreshFlowCommitStatus(),
                ]);
                refreshDeployment();
            } else if (result.remoteDeleted) {
                setFlowPushDialogOpen(false);
                if (isGroupAdmin) {
                    setRebuildDialogOpen(true);
                } else {
                    showFeedback({
                        tone: 'error',
                        title: '远程仓库已不存在',
                        detail: '请联系项目组管理员在左侧仓库工具栏恢复远程仓库后再推送',
                    });
                }
            } else {
                showFeedback({
                    tone: 'error',
                    title: '当前任务推送失败',
                    detail: result.message || '',
                });
            }
        } catch (error) {
            showError(error, '当前任务推送失败');
        } finally {
            setPushingFlow(false);
        }
    }, [
        activeFlowPath,
        groupId,
        isGroupAdmin,
        pushingFlow,
        refreshDeployment,
        refreshFlowCommitStatus,
        refreshRemoteStatus,
        refreshRepoStatus,
        setRebuildDialogOpen,
        showError,
        showFeedback,
    ]);

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

    const handleFlowCommitAndPush = useCallback(async (mode: 'save-and-commit' | 'saved-only') => {
        if (!groupId || !activeFlowPath || committing || pushingFlow) return;
        setCommitting(true);
        let committed = false;
        try {
            committed = await commitCurrentFlow(commitMessage, mode);
            if (committed) {
                setFlowCommitDialogOpen(false);
                setCommitMessage('');
            }
        } finally {
            setCommitting(false);
        }
        if (committed) {
            await handleConfirmPushCurrentFlow();
        }
    }, [activeFlowPath, commitCurrentFlow, commitMessage, committing, groupId, handleConfirmPushCurrentFlow, pushingFlow]);

    const handleOpenScheduleDialog = useCallback(() => {
        if (canvasMode === 'online') {
            if (onlineDocument) {
                setOnlineScheduleDialogOpen(true);
            }
            return;
        }
        setScheduleDialogOpen(true);
        if (activeFlowPath) {
            void loadScheduleSnapshot(activeFlowPath);
        }
    }, [activeFlowPath, canvasMode, loadScheduleSnapshot, onlineDocument, setScheduleDialogOpen]);

    const handleOpenDependencyDialog = useCallback(() => {
        if (canvasMode === 'online') {
            if (onlineDocument) {
                setOnlineDependencyDialogOpen(true);
            }
            return;
        }
        setDependencyDialogOpen(true);
    }, [canvasMode, onlineDocument]);

    const handleOpenParameterDialog = useCallback(() => {
        if (canvasMode === 'online') {
            if (onlineDocument) {
                setOnlineParameterDialogOpen(true);
            }
            return;
        }
        setParameterDialogOpen(true);
    }, [canvasMode, onlineDocument]);

    const handleStageParameterBinding = useCallback((binding: FlowParameterBinding | null) => {
        setDraftSession((current) => current
            ? updateFlowParameterBindingDraft(current, binding)
            : current);
        showSuccess(binding ? '参数组已暂存' : '已暂存解除绑定', '自动保存后生效');
    }, [setDraftSession, showSuccess]);

    const handleSelectAllNodes = useCallback((selected: boolean) => {
        setDraftSelectedTaskIds(selected && flowDocument
            ? flattenFlowDocumentNodes(flowDocument).map((node) => node.taskId)
            : []);
    }, [flowDocument, setDraftSelectedTaskIds]);

    const handleRepoCommit = useCallback(async (mode: 'save-and-commit' | 'saved-only') => {
        if (!groupId) return;
        setCommitting(true);
        try {
            const committed = await commitRepository(commitMessage, {
                saveCurrentFlowBeforeCommit: mode === 'save-and-commit' && activeFlowPath && isDirty
                    ? () => flushDraftNow()
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
    }, [groupId, activeFlowPath, commitMessage, isDirty, flushDraftNow, commitRepository, refreshFlowCommitStatus]);

    const handleOpenFlowCommitDialog = useCallback(() => {
        if (!groupId || !activeFlowPath || !flowDocument) return;
        const rollbackEntries = Object.entries(activeRollbackIssues);
        if (rollbackEntries.length > 0) {
            const [taskId, reason] = rollbackEntries[0];
            showFeedback({
                tone: 'error',
                title: '请先修复节点数据源配置',
                detail: `节点「${taskId}」${reason}`,
            });
            return;
        }
        if (!validateDocumentForAction()) return;
        setFlowCommitDialogOpen(true);
    }, [activeFlowPath, activeRollbackIssues, flowDocument, groupId, showFeedback, validateDocumentForAction]);

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
                            canWrite: canWrite && !nodeEditorOpen && !onlineNodeEditorOpen && draftSaveState !== 'saving' && !isDirty,
                            onOpenFlow: (path) => void openFlowDocument(path),
                            onContextMenu: handleContextMenu,
                            onMoveNode: handleMoveNode,
                        }}
                    />
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel id="main" order={2} defaultSize={80}>
                    <OfflineWorkbenchMainPanel
                        activeFlowPath={activeFlowPath}
                        groupId={groupId}
                        branch={repoStatus?.branch ?? null}
                        canvasMode={canvasMode}
                        onCanvasModeChange={handleCanvasModeChange}
                        onlineStatus={onlineStatus}
                        onlineDocument={onlineDocument}
                        onlineRevision={confirmedRevision}
                        deploymentConfig={deploymentConfig}
                        onlineError={onlineError}
                        onRetryOnlineSnapshot={refreshOnlineSnapshot}
                        onlineActiveNodeId={onlineActiveNodeId}
                        onSelectOnlineNode={setOnlineActiveNodeId}
                        onOpenOnlineNodeEditor={handleOpenOnlineNodeEditor}
                        flowDocument={flowDocument}
                        canWrite={canWrite}
                        canConfigureParameters={canConfigureParameters}
                        timezone={flowDocument?.runtimeTimezone || flowDocument?.schedule?.timezone || defaultTimezone}
                        nodeCount={nodeCount}
                        selectedTaskIds={selectedTaskIds}
                        activeNodeId={activeNodeId}
                        nodeIssues={nodeIssues}
                        nodeStatuses={nodeStatuses}
                        dirty={isDirty}
                        commitDirty={flowCommitDirty}
                        flowAhead={flowAhead}
                        committing={committing}
                        pushingFlow={pushingFlow}
                        staleDraft={!!staleDraft}
                        draftSaveState={draftSaveState}
                        draftSavedAt={draftSavedAt}
                        draftSaveError={draftSaveError}
                        onSelectAllNodes={handleSelectAllNodes}
                        onOpenFlowCommitDialog={handleOpenFlowCommitDialog}
                        onOpenFlowPushDialog={() => setFlowPushDialogOpen(true)}
                        onOpenScheduleDialog={handleOpenScheduleDialog}
                        onOpenDependencyDialog={handleOpenDependencyDialog}
                        onOpenParameterDialog={handleOpenParameterDialog}
                        onExecute={() => void handleExecute()}
                        onOpenExecutionDialog={openExecutionDialog}
                        onOpenVersions={() => setVersionHistoryOpen(true)}
                        onDiscardStaleDraft={handleDiscardStaleDraft}
                        onRestoreStaleDraft={handleRestoreStaleDraft}
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

            <OfflineExecutionDialog
                open={executionDialogOpen}
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
                onStopAll={() => void handleStopAllExecutions()}
                onRequestedByFilterChange={(requestedBy) => {
                    setExecutionRequestedByFilter(requestedBy);
                    void refreshExecutions(activeExecutionId, requestedBy);
                }}
            />

            <ExecutionTimeContextDialog
                open={executionContextDialogOpen}
                timezone={executionTimeRequirement.timezone || flowDocument?.runtimeTimezone || flowDocument?.schedule?.timezone || defaultTimezone}
                parameterKeys={executionTimeRequirement.parameterKeys}
                definitions={flowDocument?.parameterBinding?.definitions}
                plannedTime={plannedTime}
                parameterOverrides={parameterOverrides}
                pending={executionSubmitting}
                onOpenChange={setExecutionContextDialogOpen}
                onPlannedTimeChange={setPlannedTime}
                onParameterOverridesChange={setParameterOverrides}
                onConfirm={() => void handleConfirmExecution()}
            />

            <DependencyAwareScheduleDialog
                groupId={groupId}
                path={activeFlowPath}
                dependencyConfig={flowDocument?.dependencyConfig}
                savedPeriod={draftSession?.baseDocument.schedule?.period ?? null}
                open={canvasMode === 'dev' && scheduleDialogOpen}
                schedule={schedule}
                cron={scheduleCron || ''}
                period={schedulePeriod}
                timezone={scheduleTimezone || ''}
                saving={scheduleSaving}
                flowId={flowDocument?.flowId ?? null}
                hasRemote={remoteStatus?.hasRemote ?? repoStatus?.hasRemote ?? true}
                hasLocalOrUnpushedChanges={isDirty || !!repoStatus?.dirty || !!repoStatus?.ahead}
                onOpenChange={(open) => {
                    setScheduleDialogOpen(open);
                    if (open && activeFlowPath) {
                        void loadScheduleSnapshot(activeFlowPath);
                    }
                }}
                onPeriodChange={changeSchedulePeriod}
                onSave={() => void handleScheduleSave()}
                onToggle={(enabled) => void handleScheduleToggle(enabled)}
            />

            {canvasMode === 'dev' && dependencyDialogOpen && groupId && flowDocument && flowDocument.groupId === groupId ? (
                <DependencyDialog
                    key={`${groupId}:${activeFlowPath}`}
                    groupId={groupId}
                    document={flowDocument}
                    canWrite={canWrite}
                    onClose={() => setDependencyDialogOpen(false)}
                    onStage={(config) => {
                        if (!canWrite) return;
                        setDraftSession((current) => current ? updateFlowDependencyDraft(current, config) : current);
                        setDependencyDialogOpen(false);
                        showSuccess('依赖配置已暂存', '自动保存后生效');
                    }}
                />
            ) : null}

            {groupId && flowDocument ? (
                <FlowParameterDialog
                    open={canvasMode === 'dev' && parameterDialogOpen}
                    groupId={groupId}
                    binding={flowDocument.parameterBinding}
                    onOpenChange={setParameterDialogOpen}
                    onStage={handleStageParameterBinding}
                />
            ) : null}

            {groupId && activeFlowPath ? (
                <OfflineVersionHistoryDrawer
                    groupId={groupId}
                    path={activeFlowPath}
                    open={versionHistoryOpen}
                    canWrite={canWrite}
                    onOpenChange={setVersionHistoryOpen}
                    onCompare={(base, target) => void handleCompareVersions(base, target)}
                    onRollback={(selection) => setRollbackTarget(selection)}
                />
            ) : null}

            {groupId && activeFlowPath && versionCompare ? (
                <OfflineVersionCompareDialog
                    groupId={groupId}
                    path={activeFlowPath}
                    base={versionCompare.base}
                    target={versionCompare.target}
                    open={versionCompare.open}
                    canWrite={canWrite}
                    onOpenChange={(open) => setVersionCompare((current) => current ? { ...current, open } : null)}
                    onBeforeLoadWorktree={ensureWorktreeFlushed}
                    onRollback={(selection) => setRollbackTarget(selection)}
                />
            ) : null}

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
                onCommitAndPushFlow={(mode) => void handleFlowCommitAndPush(mode)}
                onCommitRepo={(mode) => void handleRepoCommit(mode)}
            />

            <Dialog
                open={flowPushDialogOpen}
                onOpenChange={(open) => {
                    if (!open && !pushingFlow) {
                        setFlowPushDialogOpen(false);
                    }
                }}
            >
                <DialogContent style={{ maxWidth: '460px' }} hideClose>
                    <div className="dialog-toolbar">
                        <DialogHeader className="flex-1" style={{ padding: 0, borderBottom: 'none' }}>
                            <DialogTitle className="flex items-center gap-2">
                                <ArrowUpRight size={16} aria-hidden="true" />
                                <span>推送当前任务</span>
                            </DialogTitle>
                            <DialogDescription>
                                仅将当前任务「{flowDocument?.flowId ?? activeFlowPath ?? ''}」在分支「{branchLabel}」上已提交的改动推送到远程仓库，不会带入其他任务尚未推送的提交。
                            </DialogDescription>
                        </DialogHeader>
                        <button
                            type="button"
                            data-slot="dialog-close"
                            className="dialog-close-button"
                            aria-label="关闭"
                            onClick={() => setFlowPushDialogOpen(false)}
                            disabled={pushingFlow}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {(isDirty || flowCommitDirty) ? (
                        <div className="dialog-body">
                            <div className="offline-conflict-copy" role="alert">
                                <AlertTriangle size={16} />
                                <div>
                                    <strong>当前任务仍有未提交的工作区修改</strong>
                                    <p>本次推送仅发送已提交的历史版本，不会发送未提交改动；如需一起提交，请在“提交当前任务”中使用“提交并推送”。</p>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <DialogFooter className="dialog-footer">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setFlowPushDialogOpen(false)}
                            disabled={pushingFlow}
                        >
                            取消
                        </Button>
                        <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => void handleConfirmPushCurrentFlow()}
                            disabled={pushingFlow}
                        >
                            {pushingFlow ? <LoaderCircle size={14} className="offline-spin" aria-hidden="true" /> : null}
                            <span>{pushingFlow ? '推送中…' : '确认推送'}</span>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <OfflineRepositoryDialogs
                pushDialogOpen={pushDialogOpen}
                pushLoading={pushLoading}
                onPushDialogOpenChange={setPushDialogOpen}
                onPush={() => void (async () => {
                    try {
                        await pushRepository();
                    } finally {
                        refreshDeployment();
                    }
                })()}
                discardBranchSwitchOpen={discardBranchSwitchOpen}
                branchSwitching={branchSwitching}
                pendingBranchSwitch={pendingBranchSwitch}
                onDiscardBranchSwitchOpenChange={setDiscardBranchSwitchOpen}
                onConfirmDiscardDraftAndSwitchBranch={confirmDiscardDraftAndSwitchBranch}
                rebuildDialogOpen={rebuildDialogOpen}
                rebuildLoading={rebuildLoading}
                onRebuildDialogOpenChange={setRebuildDialogOpen}
                onRebuildRemote={() => void (async () => {
                    try {
                        await rebuildRemote();
                    } finally {
                        refreshDeployment();
                    }
                })()}
            />

            <NodeEditorDialog
                open={canvasMode === 'dev' && nodeEditorOpen}
                activeNode={activeNode}
                groupId={groupId}
                content={nodeEditorContent}
                parameterDefinitions={flowDocument?.parameterBinding?.definitions}
                onOpenChange={handleNodeEditorOpenChange}
                onTempSave={handleNodeEditorTempSave}
                onContentChange={handleNodeEditorContentChange}
                onDraftChange={handleNodeEditorDraftChange}
                onTransferChange={handleTransferNodeDraftChange}
            />

            {canvasMode === 'online' && groupId && onlineDocument ? (
                <>
                    <ScheduleDialog
                        open={onlineScheduleDialogOpen}
                        readOnly
                        readOnlyRevision={confirmedRevision}
                        schedule={onlineScheduleResponse}
                        cron={onlineScheduleResponse?.cron ?? ''}
                        period={onlineScheduleResponse?.period ?? 'DAILY'}
                        timezone={onlineDocument.runtimeTimezone || onlineScheduleResponse?.timezone || defaultTimezone}
                        saving={false}
                        flowId={onlineDocument.flowId ?? null}
                        onOpenChange={setOnlineScheduleDialogOpen}
                        onPeriodChange={NOOP}
                        onSave={NOOP}
                        onToggle={NOOP}
                    />

                    {onlineDependencyDialogOpen ? (
                        <DependencyDialog
                            key={`online:${groupId}:${onlineDocument.path}:${confirmedRevision ?? ''}`}
                            groupId={groupId}
                            document={onlineDocument}
                            canWrite={false}
                            readOnly
                            readOnlyRevision={confirmedRevision}
                            onClose={() => setOnlineDependencyDialogOpen(false)}
                            onStage={NOOP}
                        />
                    ) : null}

                    <FlowParameterDialog
                        open={onlineParameterDialogOpen}
                        groupId={groupId}
                        binding={onlineDocument.parameterBinding}
                        readOnly
                        readOnlyRevision={confirmedRevision}
                        onOpenChange={setOnlineParameterDialogOpen}
                        onStage={NOOP}
                    />

                    <NodeEditorDialog
                        open={onlineNodeEditorOpen}
                        readOnly
                        activeNode={onlineActiveNode}
                        groupId={groupId}
                        content={onlineNodeContent}
                        parameterDefinitions={onlineDocument.parameterBinding?.definitions}
                        onOpenChange={setOnlineNodeEditorOpen}
                        onTempSave={NOOP}
                        onContentChange={NOOP}
                    />
                </>
            ) : null}

            <OfflineTreeActionDialogs
                repoTree={repoTree}
                canWrite={canWrite}
                createFlow={{
                    open: newFlowDialogOpen,
                    name: newFlowName,
                    parentPath: newFlowParentPath,
                    timezone: newFlowTimezone,
                    crossGroupDependency: newFlowCrossGroupDependency,
                    onCrossGroupDependencyChange: setNewFlowCrossGroupDependency,
                    pending: newFlowCreating,
                    onOpenChange: setNewFlowDialogOpen,
                    onNameChange: setNewFlowName,
                    onParentPathChange: setNewFlowParentPath,
                    onTimezoneChange: setNewFlowTimezone,
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
                    groupId,
                    path: deleteFlowPath,
                    error: deleteFlowError,
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
                    onCopyFlowName: (node) => void handleCopyFlowName(node),
                    onOpenNewFlow: openNewFlowDialogFromContext,
                    onOpenNewFolder: openNewFolderDialogFromContext,
                    onOpenRenameFlow: openRenameFlowDialogFromContext,
                    onOpenRenameFolder: openRenameFolderDialogFromContext,
                    onOpenDeleteFlow: openDeleteFlowDialogFromContext,
                    onOpenDeleteFolder: openDeleteFolderDialogFromContext,
                }}
            />

            <Dialog
                open={rollbackTarget !== null}
                onOpenChange={(open) => {
                    if (!open && !rollingBack) {
                        setRollbackTarget(null);
                    }
                }}
            >
                <DialogContent style={{ maxWidth: '520px' }} hideClose>
                    <div className="dialog-toolbar">
                        <DialogHeader className="flex-1" style={{ padding: 0, borderBottom: 'none' }}>
                            <DialogTitle className="flex items-center gap-2">
                                <RotateCcw size={16} aria-hidden="true" />
                                <span>
                                    确认回滚到版本 {rollbackTarget ? (rollbackTarget.shortRevision?.trim() || formatRevisionTag(rollbackTarget.revision)) : ''}
                                </span>
                            </DialogTitle>
                            <DialogDescription>
                                此操作仅覆盖当前任务工作区草稿（WORKTREE），不会自动提交或推送，也不会影响线上调度中的版本。
                            </DialogDescription>
                        </DialogHeader>
                        <button
                            type="button"
                            data-slot="dialog-close"
                            className="dialog-close-button"
                            aria-label="关闭"
                            onClick={() => setRollbackTarget(null)}
                            disabled={rollingBack}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <div className="dialog-body" style={{ display: 'grid', gap: 12 }}>
                        {rollbackTarget ? (
                            <div
                                style={{
                                    padding: '10px 12px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-bg-secondary)',
                                    fontSize: 13,
                                    display: 'grid',
                                    gap: 4,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>目标提交</span>
                                    <code>{rollbackTarget.shortRevision?.trim() || formatRevisionTag(rollbackTarget.revision)}</code>
                                </div>
                                <div style={{ color: 'var(--color-text-primary)', fontWeight: 500, wordBreak: 'break-word' }}>
                                    {rollbackTarget.message?.trim() || '未填写提交说明'}
                                </div>
                            </div>
                        ) : null}

                        {isDirty || flowCommitDirty ? (
                            <div className="offline-conflict-copy" role="alert">
                                <AlertTriangle size={16} />
                                <div>
                                    <strong>当前工作区有未保存或未提交的修改</strong>
                                    <p>继续回滚将直接覆盖这些修改；如需先核对差异，可点击下方“先与工作区对比”。</p>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <DialogFooter className="dialog-footer" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCompareRollbackWithWorktree}
                            disabled={rollingBack || !rollbackTarget}
                        >
                            <GitCompare size={14} aria-hidden="true" />
                            <span>先与工作区对比</span>
                        </Button>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setRollbackTarget(null)}
                                disabled={rollingBack}
                            >
                                取消
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => void handleConfirmRollback()}
                                disabled={rollingBack || savingFlow}
                            >
                                {rollingBack ? <LoaderCircle size={14} className="offline-spin" aria-hidden="true" /> : null}
                                <span>{rollingBack ? '回滚中…' : '确认回滚'}</span>
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </section>
    );
}
