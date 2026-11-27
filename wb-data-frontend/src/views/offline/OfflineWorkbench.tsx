import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import '@/components/loading/RouteSkeletons.css';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable';
import type { AssetOwnerSummary } from '../../api/groupSettings';
import {
    getOfflineFlowOwners,
    transferOfflineFlowOwner,
    type OfflineFlowDependencySettings,
} from '../../api/offline';
import { TransferOwnerDialog } from '../../components/owner/TransferOwnerDialog';
import { preloadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useAuthStore } from '../../utils/auth';
import { flattenFlowDocumentNodes } from './draft/flowDocumentMutations';
import { computeExecutionNodeStatuses, computeFlowNodeIssues } from './draft/flowNodeIssues';
import { validateSqlNodeDataSourceRequirement } from './editor/nodeEditorDataSourceRules';
import { prefetchNodeEditorDataSources } from './editor/useNodeEditorDataSources';
import { useOfflinePublishWorkflow } from './repo/useOfflinePublishWorkflow';
import { useOfflineRepoTree } from './repo/useOfflineRepoTree';
import { useOfflineRepositoryWorkflow } from './repo/useOfflineRepositoryWorkflow';
import { useOfflineTreeMutations } from './repo/useOfflineTreeMutations';
import type { TransferNodeDraftState } from './transfer/TransferNodeDialog';
import type { TransferConfig } from './transfer/transferTypes';
import { useOfflineOnlineMode } from './version/useOfflineOnlineMode';
import { useOfflineVersionWorkflow } from './version/useOfflineVersionWorkflow';
import type { CanvasMode } from './version/useOnlineFlowSnapshot';
import { OfflineWorkbenchDialogs } from './OfflineWorkbenchDialogs';
import {
    useOfflineWorkbenchBeforeUnloadLeave,
    useOfflineWorkbenchBranchEvent,
    useOfflineWorkbenchGroupLifecycle,
    useOfflineWorkbenchNewFlowShortcut,
    useOfflineWorkbenchUrlRestore,
} from './OfflineWorkbenchLifecycle';
import { OfflineWorkbenchMainPanel } from './OfflineWorkbenchMainPanel';
import { OfflineWorkbenchSidebar } from './OfflineWorkbenchSidebar';
import { useOfflineWorkbenchNavigation } from './useOfflineWorkbenchNavigation';
import { useOfflineWorkbenchSession } from './useOfflineWorkbenchSession';
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
    const canManageOthersOwnership = systemAdmin || isGroupAdmin || permissions.includes('member.manage');
    const defaultTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
    const { showFeedback, showSuccess, showError } = useOperationFeedback();

    const [parameterDialogOpen, setParameterDialogOpen] = useState(false);
    const [dependencyDialogOpen, setDependencyDialogOpen] = useState(false);
    const [flowOwners, setFlowOwners] = useState<AssetOwnerSummary[]>([]);
    const [transferState, setTransferState] = useState<{
        open: boolean;
        mode: 'selected' | 'by-owner';
        flowPaths: string[];
        flowNames: string[];
        initialFromOwnerUserId: number | null;
    }>({
        open: false,
        mode: 'selected',
        flowPaths: [],
        flowNames: [],
        initialFromOwnerUserId: null,
    });
    const [transferPending, setTransferPending] = useState(false);
    const [transferError, setTransferError] = useState('');

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

    const repoWorkflow = useOfflineRepositoryWorkflow({
        groupId,
        canManageBranches: isGroupAdmin && !!groupId,
        showFeedback,
    });
    const { refreshRepoStatus, refreshRemoteStatus, resetBranchList, resetBranchSwitchState, requestBranchSwitch } = repoWorkflow;

    const session = useOfflineWorkbenchSession({
        groupId,
        canWrite,
        defaultTimezone,
        showFeedback,
        showSuccess,
        refreshRepoStatus,
    });
    const { flowEditing, flowExecutionAndSchedule, stageDependencyConfig } = session;
    const {
        activeFlowPath,
        flowDocument,
        draftSession,
        activeNodeId,
        isDirty,
        flushDraftNow,
        refreshFlowCommitStatus,
        saveNodeEditorDraft,
        stageNodeEditorDraft,
        nodeEditorContent,
        resetAfterBranchSwitch,
    } = flowEditing;
    const { setScheduleDialogOpen, loadScheduleSnapshot, executionDetail } = flowExecutionAndSchedule;

    const { repoTree, treeLoading, refreshRepoTree, resolveTreeNode } = useOfflineRepoTree({
        groupId,
        savedDocument: draftSession?.baseDocument,
        showError,
    });

    const onlineMode = useOfflineOnlineMode({
        groupId,
        branch: repoWorkflow.repoStatus?.branch ?? null,
        activeFlowPath,
        defaultTimezone,
    });
    const {
        setCanvasMode,
        refreshDeployment,
        handleCanvasModeChange: changeCanvasMode,
        setOnlineScheduleDialogOpen,
        setOnlineDependencyDialogOpen,
        setOnlineParameterDialogOpen,
    } = onlineMode;

    const switchToDevMode = useCallback(() => setCanvasMode('dev'), [setCanvasMode]);

    useEffect(() => { setDependencyDialogOpen(false); }, [groupId, activeFlowPath]);
    useEffect(() => {
        if (!groupId || !activeFlowPath) return;
        void refreshFlowCommitStatus();
    }, [activeFlowPath, groupId, refreshFlowCommitStatus, repoWorkflow.repoStatus?.ahead, repoWorkflow.repoStatus?.headCommitId]);

    const versionWorkflow = useOfflineVersionWorkflow({
        groupId,
        activeFlowPath,
        flowDocument,
        draftSession,
        canWrite,
        savingFlow: flowEditing.savingFlow,
        isDirty,
        flowCommitDirty: flowEditing.flowCommitDirty,
        flushPendingDraftIfDirty: flowEditing.flushPendingDraftIfDirty,
        applyFlowDocumentPayload: flowEditing.applyFlowDocumentPayload,
        loadScheduleSnapshot,
        refreshRepoStatus,
        refreshFlowCommitStatus,
        onSwitchToDevMode: switchToDevMode,
        showFeedback,
        showSuccess,
    });
    const { clearRollbackNodeIssue } = versionWorkflow;

    const publishWorkflow = useOfflinePublishWorkflow({
        groupId,
        activeFlowPath,
        flowDocument,
        isGroupAdmin,
        isDirty,
        activeRollbackIssues: versionWorkflow.activeRollbackIssues,
        validateDocumentForAction: flowEditing.validateDocumentForAction,
        flushDraftNow,
        commitCurrentFlow: flowEditing.commitCurrentFlow,
        commitRepository: repoWorkflow.commitRepo,
        refreshRemoteStatus,
        refreshRepoStatus,
        refreshFlowCommitStatus,
        refreshDeployment,
        setRebuildDialogOpen: repoWorkflow.setRebuildDialogOpen,
        showFeedback,
        showError,
    });

    const nodeIssues = useMemo(
        () => computeFlowNodeIssues(flowDocument, versionWorkflow.activeRollbackIssues),
        [flowDocument, versionWorkflow.activeRollbackIssues],
    );
    const nodeStatuses = useMemo(() => computeExecutionNodeStatuses(executionDetail), [executionDetail]);

    const refreshWorkspace = useCallback(async () => {
        await Promise.all([refreshRepoStatus(), refreshRepoTree(), refreshRemoteStatus()]);
        refreshDeployment();
    }, [refreshDeployment, refreshRepoStatus, refreshRepoTree, refreshRemoteStatus]);

    const { openFlowDocument } = useOfflineWorkbenchNavigation({
        groupId,
        draftSession,
        isDirty,
        openFlowDocumentFromSession: flowEditing.openFlowDocument,
        flushDraft: flushDraftNow,
    });

    const handleBranchSwitchRequest = useCallback((branchName: string) => {
        void (async () => {
            if (isDirty) await flushDraftNow();
            requestBranchSwitch(branchName, {
                afterSwitch: async () => {
                    resetAfterBranchSwitch();
                    await refreshWorkspace();
                },
            });
        })();
    }, [flushDraftNow, isDirty, refreshWorkspace, requestBranchSwitch, resetAfterBranchSwitch]);

    const treeMutations = useOfflineTreeMutations({
        groupId,
        currentUserId: currentUser?.id ?? null,
        activeFlowPath,
        draftSession,
        defaultTimezone,
        refreshRepoTree: refreshWorkspace,
        openFlowDocument,
        leaveCurrentFlow: flowEditing.leaveCurrentFlow,
        setActiveFlowPath: flowEditing.setActiveFlowPath,
        setDraftSession: flowEditing.setDraftSession,
        showFeedback,
        resolveTreeNode,
    });

    const loadFlowOwners = useCallback(async () => {
        if (!groupId || typeof getOfflineFlowOwners !== 'function') {
            setFlowOwners([]);
            return;
        }
        try {
            const list = await getOfflineFlowOwners(groupId);
            setFlowOwners(Array.isArray(list) ? list : []);
        } catch {
            // 降级使用目录树中已缓存的负责人信息
        }
    }, [groupId]);

    useEffect(() => {
        void loadFlowOwners();
    }, [loadFlowOwners, repoTree]);

    const handleOpenSingleFlowTransfer = useCallback((flowPath: string, flowName: string) => {
        setTransferError('');
        setTransferState({
            open: true,
            mode: 'selected',
            flowPaths: [flowPath],
            flowNames: [flowName],
            initialFromOwnerUserId: null,
        });
    }, []);

    const handleOpenBulkFlowTransfer = useCallback((initialFromOwnerUserId: number | null) => {
        setTransferError('');
        setTransferState({
            open: true,
            mode: 'by-owner',
            flowPaths: [],
            flowNames: [],
            initialFromOwnerUserId: canManageOthersOwnership ? initialFromOwnerUserId : (currentUser?.id ?? null),
        });
    }, [canManageOthersOwnership, currentUser?.id]);

    const handleTransferFlowOwnerConfirm = useCallback(async (payload: {
        ids?: number[];
        fromOwnerUserId?: number;
        targetOwnerUserId: number;
    }) => {
        if (!groupId || typeof transferOfflineFlowOwner !== 'function') return;
        setTransferPending(true);
        setTransferError('');
        try {
            const result = await transferOfflineFlowOwner(
                groupId,
                transferState.mode === 'selected'
                    ? { paths: transferState.flowPaths, targetOwnerUserId: payload.targetOwnerUserId }
                    : { fromOwnerUserId: payload.fromOwnerUserId, targetOwnerUserId: payload.targetOwnerUserId },
            );
            setTransferState((prev) => ({ ...prev, open: false }));
            showSuccess(`已将 ${result.updatedCount} 个离线任务移交给「${result.targetOwnerName}」`);
            await Promise.all([refreshWorkspace(), loadFlowOwners()]);
            if (
                activeFlowPath
                && !isDirty
                && (transferState.mode === 'by-owner' || transferState.flowPaths.includes(activeFlowPath))
            ) {
                await openFlowDocument(activeFlowPath);
            }
        } catch (error) {
            const message = error instanceof Error && error.message ? error.message : '转移负责人失败，请重试';
            setTransferError(message);
            showError(error, '转移负责人失败');
        } finally {
            setTransferPending(false);
        }
    }, [
        activeFlowPath,
        groupId,
        isDirty,
        loadFlowOwners,
        openFlowDocument,
        refreshWorkspace,
        showError,
        showSuccess,
        transferState.flowPaths,
        transferState.mode,
    ]);

    const canTransferActiveFlow = Boolean(
        activeFlowPath
        && flowDocument
        && (
            canManageOthersOwnership
            || (canWrite && currentUser?.id != null && flowDocument.ownerUserId === currentUser.id)
        ),
    );

    useOfflineWorkbenchGroupLifecycle({
        groupId,
        leaveCurrentFlow: flowEditing.leaveCurrentFlow,
        resetActiveFlow: resetAfterBranchSwitch,
        resetBranchList,
        resetBranchSwitchState,
        refreshWorkspace,
    });
    useOfflineWorkbenchBranchEvent({
        groupId,
        resetActiveFlow: resetAfterBranchSwitch,
        resetBranchList,
        resetBranchSwitchState,
        refreshWorkspace,
    });
    useOfflineWorkbenchUrlRestore({ groupId, repoTree, searchParams, openFlowDocument });
    useOfflineWorkbenchBeforeUnloadLeave({ groupId, draftSession, leaveCurrentFlow: flowEditing.leaveCurrentFlow });
    useOfflineWorkbenchNewFlowShortcut({
        newFlowDialogOpen: treeMutations.newFlowDialogOpen,
        nodeEditorOpen: flowEditing.nodeEditorOpen || onlineMode.onlineNodeEditorOpen,
        executionDialogOpen: flowExecutionAndSchedule.executionDialogOpen,
        executionContextDialogOpen: flowExecutionAndSchedule.executionContextDialogOpen,
        scheduleDialogOpen: flowExecutionAndSchedule.scheduleDialogOpen || onlineMode.onlineScheduleDialogOpen,
        parameterDialogOpen: parameterDialogOpen || onlineMode.onlineParameterDialogOpen,
        dependencyDialogOpen: dependencyDialogOpen || onlineMode.onlineDependencyDialogOpen,
        openRootNewFlowDialog: treeMutations.openRootNewFlowDialog,
    });

    const handleCanvasModeChange = useCallback((nextMode: CanvasMode) => {
        changeCanvasMode(nextMode, () => {
            setScheduleDialogOpen(false);
            setDependencyDialogOpen(false);
            setParameterDialogOpen(false);
        });
    }, [changeCanvasMode, setScheduleDialogOpen]);

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
        showFeedback(validation.feedback ?? { tone: 'success', title: '草稿已暂存', detail: '自动保存后生效' });
    }, [activeNodeId, clearRollbackNodeIssue, flowDocument, saveNodeEditorDraft, showFeedback]);

    const handleTransferNodeDraftChange = useCallback((transferDraft: TransferConfig, state: TransferNodeDraftState) => {
        stageNodeEditorDraft(nodeEditorContent, undefined, undefined, state.valid ? transferDraft : undefined, transferDraft, state.valid);
        if (state.valid && activeNodeId) clearRollbackNodeIssue(activeNodeId);
    }, [activeNodeId, clearRollbackNodeIssue, nodeEditorContent, stageNodeEditorDraft]);

    const handleOpenScheduleDialog = useCallback(() => {
        if (onlineMode.canvasMode === 'online') {
            if (onlineMode.onlineDocument) setOnlineScheduleDialogOpen(true);
            return;
        }
        setScheduleDialogOpen(true);
        if (activeFlowPath) void loadScheduleSnapshot(activeFlowPath);
    }, [activeFlowPath, loadScheduleSnapshot, onlineMode.canvasMode, onlineMode.onlineDocument, setOnlineScheduleDialogOpen, setScheduleDialogOpen]);

    const handleOpenDependencyDialog = useCallback(() => {
        if (onlineMode.canvasMode === 'online') {
            if (onlineMode.onlineDocument) setOnlineDependencyDialogOpen(true);
            return;
        }
        setDependencyDialogOpen(true);
    }, [onlineMode.canvasMode, onlineMode.onlineDocument, setOnlineDependencyDialogOpen]);

    const handleOpenParameterDialog = useCallback(() => {
        if (onlineMode.canvasMode === 'online') {
            if (onlineMode.onlineDocument) setOnlineParameterDialogOpen(true);
            return;
        }
        setParameterDialogOpen(true);
    }, [onlineMode.canvasMode, onlineMode.onlineDocument, setOnlineParameterDialogOpen]);

    const handleStageDependencyConfig = useCallback((config: OfflineFlowDependencySettings) => {
        stageDependencyConfig(config);
        setDependencyDialogOpen(false);
    }, [stageDependencyConfig]);

    const canCommitRepo = repoWorkflow.canCommitRepo
        || (!!groupId && !!repoWorkflow.repoStatus?.gitInitialized && isDirty);

    return (
        <section className="offline-page">
            <ResizablePanelGroup direction="horizontal" className="offline-workbench-resizable-shell" autoSaveId="offline-workbench-layout">
                <ResizablePanel id="sidebar" order={1} defaultSize={20} minSize={15} maxSize={40} className="offline-rail-panel-container">
                    <OfflineWorkbenchSidebar
                        isGroupAdmin={isGroupAdmin}
                        branch={{
                            label: repoWorkflow.branchLabel,
                            canSwitch: repoWorkflow.canSwitchBranch,
                            menuOpen: repoWorkflow.branchMenuOpen,
                            tooltipOpen: repoWorkflow.branchTooltipOpen,
                            loading: repoWorkflow.branchLoading,
                            switching: repoWorkflow.branchSwitching,
                            branches: repoWorkflow.branches,
                            dirtyState: repoWorkflow.branchDirtyState,
                            onToggleMenu: repoWorkflow.toggleBranchMenu,
                            onMenuOpenChange: repoWorkflow.setBranchMenuOpen,
                            onTooltipOpenChange: repoWorkflow.setBranchTooltipOpen,
                            onSwitch: handleBranchSwitchRequest,
                        }}
                        repository={{
                            available: !!groupId,
                            loading: repoWorkflow.repoLoading,
                            committing: publishWorkflow.committing,
                            pushLoading: repoWorkflow.pushLoading,
                            canCommit: canCommitRepo,
                            canPush: repoWorkflow.canPush,
                            dirty: isDirty || !!repoWorkflow.repoStatus?.dirty,
                            ahead: !!repoWorkflow.repoStatus?.ahead,
                            onRefresh: () => void refreshWorkspace(),
                            onOpenCommit: publishWorkflow.handleOpenRepoCommitDialog,
                            onOpenPush: () => repoWorkflow.setPushDialogOpen(true),
                        }}
                        creation={{
                            canWrite,
                            menuOpen: treeMutations.newItemMenuOpen,
                            onMenuOpenChange: treeMutations.setNewItemMenuOpen,
                            onOpenNewFlow: () => { treeMutations.setNewItemMenuOpen(false); treeMutations.setNewFlowDialogOpen(true); },
                            onOpenNewFolder: () => {
                                treeMutations.setNewItemMenuOpen(false);
                                treeMutations.setNewFolderParentPath('');
                                treeMutations.setNewFolderName('');
                                treeMutations.setNewFolderDialogOpen(true);
                            },
                        }}
                        tree={{
                            data: repoTree,
                            loading: treeLoading,
                            flowLoading: flowEditing.flowLoading,
                            activeFlowPath,
                            canWrite: canWrite && !flowEditing.nodeEditorOpen && !onlineMode.onlineNodeEditorOpen && flowEditing.draftSaveState !== 'saving' && !isDirty,
                            currentUserId: currentUser?.id ?? null,
                            ownerSummaries: flowOwners,
                            canBulkTransferOwner: canManageOthersOwnership || (canWrite && currentUser?.id != null),
                            onOpenBulkTransferOwner: handleOpenBulkFlowTransfer,
                            onOpenFlow: (path) => void openFlowDocument(path),
                            onContextMenu: treeMutations.handleContextMenu,
                            onMoveNode: treeMutations.handleMoveNode,
                        }}
                    />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel id="main" order={2} defaultSize={80}>
                    <OfflineWorkbenchMainPanel
                        activeFlowPath={activeFlowPath}
                        groupId={groupId}
                        branch={repoWorkflow.repoStatus?.branch ?? null}
                        canvasMode={onlineMode.canvasMode}
                        onCanvasModeChange={handleCanvasModeChange}
                        onlineStatus={onlineMode.onlineStatus}
                        onlineDocument={onlineMode.onlineDocument}
                        onlineRevision={onlineMode.confirmedRevision}
                        deploymentConfig={onlineMode.deploymentConfig}
                        onlineError={onlineMode.onlineError}
                        onRetryOnlineSnapshot={onlineMode.refreshOnlineSnapshot}
                        onlineActiveNodeId={onlineMode.onlineActiveNodeId}
                        onSelectOnlineNode={onlineMode.setOnlineActiveNodeId}
                        onOpenOnlineNodeEditor={onlineMode.handleOpenOnlineNodeEditor}
                        flowDocument={flowDocument}
                        canWrite={canWrite}
                        canConfigureParameters={canConfigureParameters}
                        timezone={flowDocument?.runtimeTimezone || flowDocument?.schedule?.timezone || defaultTimezone}
                        nodeCount={flowEditing.nodeCount}
                        selectedTaskIds={flowEditing.selectedTaskIds}
                        activeNodeId={activeNodeId}
                        nodeIssues={nodeIssues}
                        nodeStatuses={nodeStatuses}
                        dirty={isDirty}
                        commitDirty={flowEditing.flowCommitDirty}
                        flowAhead={flowEditing.flowAhead}
                        committing={publishWorkflow.committing}
                        pushingFlow={publishWorkflow.pushingFlow}
                        staleDraft={!!flowEditing.staleDraft}
                        draftSaveState={flowEditing.draftSaveState}
                        draftSavedAt={flowEditing.draftSavedAt}
                        draftSaveError={flowEditing.draftSaveError}
                        onSelectAllNodes={session.selectAllNodes}
                        onOpenFlowCommitDialog={publishWorkflow.handleOpenFlowCommitDialog}
                        onOpenFlowPushDialog={() => publishWorkflow.setFlowPushDialogOpen(true)}
                        onOpenScheduleDialog={handleOpenScheduleDialog}
                        onOpenDependencyDialog={handleOpenDependencyDialog}
                        onOpenParameterDialog={handleOpenParameterDialog}
                        onExecute={() => void flowExecutionAndSchedule.execute()}
                        onOpenExecutionDialog={flowExecutionAndSchedule.openExecutionDialog}
                        onOpenVersions={() => versionWorkflow.setVersionHistoryOpen(true)}
                        canTransferFlowOwner={canTransferActiveFlow}
                        onOpenTransferFlowOwner={() => {
                            if (activeFlowPath) {
                                handleOpenSingleFlowTransfer(activeFlowPath, flowDocument?.flowId || activeFlowPath);
                            }
                        }}
                        onDiscardStaleDraft={flowEditing.discardStaleDraft}
                        onRestoreStaleDraft={flowEditing.restoreStaleDraft}
                        onNodesChange={flowEditing.updateCanvasNodes}
                        onEdgesChange={flowEditing.updateCanvasEdges}
                        onNodeLayoutCommit={flowEditing.commitCanvasLayout}
                        onSelectNode={flowEditing.setSelectedNodeId}
                        onToggleTaskSelection={session.toggleTaskSelection}
                        onReplaceTaskSelection={session.replaceTaskSelection}
                        onDoubleClickNode={flowEditing.openNodeEditor}
                        onAddNode={flowEditing.addNode}
                        onRenameNode={flowEditing.renameNode}
                    />
                </ResizablePanel>
            </ResizablePanelGroup>

            <OfflineWorkbenchDialogs
                groupId={groupId}
                repoTree={repoTree}
                currentUserId={currentUser?.id ?? null}
                canWrite={canWrite}
                canManageOthersOwnership={canManageOthersOwnership}
                onOpenTransferFlowOwner={handleOpenSingleFlowTransfer}
                defaultTimezone={defaultTimezone}
                dependencyDialogOpen={dependencyDialogOpen}
                parameterDialogOpen={parameterDialogOpen}
                session={session}
                repositoryWorkflow={repoWorkflow}
                treeMutations={treeMutations}
                publishWorkflow={publishWorkflow}
                versionWorkflow={versionWorkflow}
                onlineMode={onlineMode}
                onDependencyDialogOpenChange={setDependencyDialogOpen}
                onStageDependencyConfig={handleStageDependencyConfig}
                onParameterDialogOpenChange={setParameterDialogOpen}
                onNodeEditorTempSave={handleNodeEditorTempSave}
                onTransferNodeDraftChange={handleTransferNodeDraftChange}
            />

            {groupId != null ? (
                <TransferOwnerDialog
                    open={transferState.open}
                    onOpenChange={(nextOpen) => {
                        if (!nextOpen && !transferPending) {
                            setTransferError('');
                            setTransferState((prev) => ({ ...prev, open: false }));
                        }
                    }}
                    groupId={groupId}
                    assetLabel="离线任务"
                    mode={transferState.mode}
                    selectedIds={transferState.mode === 'selected' ? [0] : []}
                    selectedNames={transferState.flowNames}
                    owners={flowOwners}
                    initialFromOwnerUserId={transferState.initialFromOwnerUserId}
                    restrictFromOwnerUserId={canManageOthersOwnership ? null : (currentUser?.id ?? null)}
                    pending={transferPending}
                    errorMessage={transferError}
                    onConfirm={(payload) => void handleTransferFlowOwnerConfirm(payload)}
                />
            ) : null}
        </section>
    );
}
