import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '../../utils/error';
import { ReactFlowProvider } from '@xyflow/react';
import { useBlocker, useSearchParams } from 'react-router-dom';
import FlowCanvas from './FlowCanvas';
import '../core/RouteSkeletons.css';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '../../components/ui/resizable';
import { AlertTriangle } from 'lucide-react';
import {
    getOfflineRepoTree,
    type OfflineFlowNodeKind,
    type OfflineRepoTreeResponse,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
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
    validateSqlNodeDataSourceRequirement,
} from './nodeEditorDataSourceRules';
import { SaveConflictDialog } from './SaveConflictDialog';
import { OfflineCommitDialogs } from './OfflineCommitDialogs';
import { OfflineWorkbenchSidebar } from './OfflineWorkbenchSidebar';
import { OfflineCanvasToolbar } from './OfflineCanvasToolbar';
import { OfflineTreeActionDialogs } from './OfflineTreeActionDialogs';
import { OfflineExecutionDialog } from './OfflineExecutionDialog';
import { OfflineRepositoryDialogs } from './OfflineRepositoryDialogs';
import { resolveViewportCenterFlowPosition } from './flowCanvasViewport';
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

export default function OfflineWorkbench() {
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
        const viewport = board?.querySelector<HTMLElement>('.react-flow__viewport') ?? null;
        const viewportTransform = viewport
            ? viewport.style.transform || window.getComputedStyle(viewport).transform
            : null;
        const boardRect = board?.getBoundingClientRect();
        const center = boardRect
            ? resolveViewportCenterFlowPosition({
                width: boardRect.width,
                height: boardRect.height,
                transform: viewportTransform,
            })
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
