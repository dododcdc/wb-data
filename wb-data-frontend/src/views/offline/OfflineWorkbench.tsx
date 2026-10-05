import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../core/RouteSkeletons.css';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '../../components/ui/resizable';
import {
    getOfflineRepoTree,
    type FlowParameterBinding,
    type OfflineRepoTreeResponse,
} from '../../api/offline';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useAuthStore } from '../../utils/auth';
import { NodeEditorDialog } from './NodeEditorDialog';
import type { TransferConfig } from './transfer/transferTypes';
import type { TransferNodeDraftState } from './transfer/TransferNodeDialog';
import { DependencyAwareScheduleDialog } from './DependencyAwareScheduleDialog';
import { DependencyDialog } from './DependencyDialog';
import { FlowParameterDialog } from './FlowParameterDialog';
import {
    flattenFlowDocumentNodes,
    resolveFlowSelectedTaskIds,
} from './flowDocumentMutations';
import {
    validateSqlNodeDataSourceRequirement,
} from './nodeEditorDataSourceRules';
import { SaveConflictDialog } from './SaveConflictDialog';
import { OfflineCommitDialogs } from './OfflineCommitDialogs';
import { OfflineWorkbenchSidebar } from './OfflineWorkbenchSidebar';
import { OfflineTreeActionDialogs } from './OfflineTreeActionDialogs';
import { OfflineExecutionDialog } from './OfflineExecutionDialog';
import { ExecutionTimeContextDialog } from './ExecutionTimeContextDialog';
import { OfflineRepositoryDialogs } from './OfflineRepositoryDialogs';
import { OfflineWorkbenchMainPanel } from './OfflineWorkbenchMainPanel';
import { preloadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';
import { useOfflineRepositoryWorkflow } from './useOfflineRepositoryWorkflow';
import { useOfflineTreeMutations } from './useOfflineTreeMutations';
import { indexNodesByTreePath, updateRepoTreeFlowStatus } from './repoTreePaths';
import { prefetchNodeEditorDataSources } from './useNodeEditorDataSources';
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
import { updateFlowDependencyDraft, updateFlowParameterBindingDraft } from './flowDraftController';

import './OfflineWorkbench.css';

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
    const [repoCommitDialogOpen, setRepoCommitDialogOpen] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');
    const [committing, setCommitting] = useState(false);
    const [parameterDialogOpen, setParameterDialogOpen] = useState(false);
    const [dependencyDialogOpen, setDependencyDialogOpen] = useState(false);
    const loadScheduleSnapshotRef = useRef<((path: string) => Promise<void>) | null>(null);
    const resetExecutionAndScheduleRef = useRef<(() => void) | null>(null);
    const refreshRepoStatusRef = useRef<(() => Promise<void>) | null>(null);

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
        nodeEditorOpen,
        nodeEditorContent,
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
        openFlowDocument: openFlowDocumentFromSession,
        resetAfterBranchSwitch,
        openNodeEditor: handleOpenNodeEditor,
        setNodeEditorOpen: handleNodeEditorOpenChange,
        updateNodeEditorContent: handleNodeEditorContentChange,
        stageNodeEditorDraft,
        saveNodeEditorDraft,
        flushDraftNow,
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
            return root === current.root ? current : { ...current, root };
        });
    }, [groupId, savedDocument]);

    useEffect(() => {
        setDependencyDialogOpen(false);
    }, [groupId, activeFlowPath]);

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

    const repoTreeNodeIndex = useMemo(
        () => (repoTree ? indexNodesByTreePath(repoTree.root) : null),
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
        nodeEditorOpen,
        executionDialogOpen,
        executionContextDialogOpen,
        scheduleDialogOpen,
        parameterDialogOpen,
        dependencyDialogOpen,
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
            title: '已写入本机草稿，自动保存后生效',
            detail: '',
        });
    }, [activeNodeId, flowDocument, saveNodeEditorDraft, showFeedback]);

    const handleNodeEditorDraftChange = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
        stageNodeEditorDraft(content, dataSourceId, dataSourceType);
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
    }, [nodeEditorContent, stageNodeEditorDraft]);

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
                            canWrite: canWrite && !nodeEditorOpen && draftSaveState !== 'saving' && !isDirty,
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
                        committing={committing}
                        staleDraft={!!staleDraft}
                        draftSaveState={draftSaveState}
                        draftSavedAt={draftSavedAt}
                        draftSaveError={draftSaveError}
                        onSelectAllNodes={handleSelectAllNodes}
                        onOpenFlowCommitDialog={handleOpenFlowCommitDialog}
                        onOpenScheduleDialog={handleOpenScheduleDialog}
                        onOpenDependencyDialog={() => setDependencyDialogOpen(true)}
                        onOpenParameterDialog={() => setParameterDialogOpen(true)}
                        onExecute={() => void handleExecute()}
                        onOpenExecutionDialog={openExecutionDialog}
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
                open={scheduleDialogOpen}
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

            {dependencyDialogOpen && groupId && flowDocument && flowDocument.groupId === groupId ? (
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
                        showSuccess('依赖配置已暂存', '自动保存后写入仓库');
                    }}
                />
            ) : null}

            {groupId && flowDocument ? (
                <FlowParameterDialog
                    open={parameterDialogOpen}
                    groupId={groupId}
                    binding={flowDocument.parameterBinding}
                    onOpenChange={setParameterDialogOpen}
                    onStage={handleStageParameterBinding}
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
                onCommitRepo={(mode) => void handleRepoCommit(mode)}
            />

            <OfflineRepositoryDialogs
                pushDialogOpen={pushDialogOpen}
                pushLoading={pushLoading}
                onPushDialogOpenChange={setPushDialogOpen}
                onPush={() => void pushRepository()}
                discardBranchSwitchOpen={discardBranchSwitchOpen}
                branchSwitching={branchSwitching}
                pendingBranchSwitch={pendingBranchSwitch}
                onDiscardBranchSwitchOpenChange={setDiscardBranchSwitchOpen}
                onConfirmDiscardDraftAndSwitchBranch={confirmDiscardDraftAndSwitchBranch}
                rebuildDialogOpen={rebuildDialogOpen}
                rebuildLoading={rebuildLoading}
                onRebuildDialogOpenChange={setRebuildDialogOpen}
                onRebuildRemote={() => void rebuildRemote()}
            />

            <NodeEditorDialog
                open={nodeEditorOpen}
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

        </section>
    );
}
