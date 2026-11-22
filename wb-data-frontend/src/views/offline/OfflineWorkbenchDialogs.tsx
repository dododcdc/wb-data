import type { Dispatch, SetStateAction } from 'react';
import type { OfflineFlowDependencySettings, OfflineRepoTreeResponse } from '../../api/offline';
import { SaveConflictDialog } from './draft/SaveConflictDialog';
import { NodeEditorDialog } from './editor/NodeEditorDialog';
import { ExecutionTimeContextDialog } from './execution/ExecutionTimeContextDialog';
import { OfflineExecutionDialog } from './execution/OfflineExecutionDialog';
import { OfflineCommitDialogs } from './repo/OfflineCommitDialogs';
import { OfflineFlowPushDialog } from './repo/OfflineFlowPushDialog';
import { OfflineRepositoryDialogs } from './repo/OfflineRepositoryDialogs';
import { OfflineTreeActionDialogs } from './repo/OfflineTreeActionDialogs';
import type { useOfflinePublishWorkflow } from './repo/useOfflinePublishWorkflow';
import type { useOfflineRepositoryWorkflow } from './repo/useOfflineRepositoryWorkflow';
import type { useOfflineTreeMutations } from './repo/useOfflineTreeMutations';
import { DependencyAwareScheduleDialog } from './schedule/DependencyAwareScheduleDialog';
import { DependencyDialog } from './schedule/DependencyDialog';
import { FlowParameterDialog } from './schedule/FlowParameterDialog';
import type { TransferConfig } from './transfer/transferTypes';
import type { TransferNodeDraftState } from './transfer/TransferNodeDialog';
import type { useOfflineWorkbenchSession } from './useOfflineWorkbenchSession';
import { OfflineOnlineInspectionDialogs } from './version/OfflineOnlineInspectionDialogs';
import { OfflineRollbackConfirmDialog } from './version/OfflineRollbackConfirmDialog';
import { OfflineVersionCompareDialog } from './version/OfflineVersionCompareDialog';
import { OfflineVersionHistoryDrawer } from './version/OfflineVersionHistoryDrawer';
import type { useOfflineOnlineMode } from './version/useOfflineOnlineMode';
import type { useOfflineVersionWorkflow } from './version/useOfflineVersionWorkflow';

type WorkbenchSessionState = ReturnType<typeof useOfflineWorkbenchSession>;
type RepositoryWorkflowState = ReturnType<typeof useOfflineRepositoryWorkflow>;
type TreeMutationsState = ReturnType<typeof useOfflineTreeMutations>;
type PublishWorkflowState = ReturnType<typeof useOfflinePublishWorkflow>;
type VersionWorkflowState = ReturnType<typeof useOfflineVersionWorkflow>;
type OnlineModeState = ReturnType<typeof useOfflineOnlineMode>;

interface OfflineWorkbenchDialogsProps {
    groupId: number | null;
    repoTree: OfflineRepoTreeResponse | null;
    currentUserId: number | null;
    canWrite: boolean;
    defaultTimezone: string;
    dependencyDialogOpen: boolean;
    parameterDialogOpen: boolean;
    session: WorkbenchSessionState;
    repositoryWorkflow: RepositoryWorkflowState;
    treeMutations: TreeMutationsState;
    publishWorkflow: PublishWorkflowState;
    versionWorkflow: VersionWorkflowState;
    onlineMode: OnlineModeState;
    onDependencyDialogOpenChange: (open: boolean) => void;
    onStageDependencyConfig: (config: OfflineFlowDependencySettings) => void;
    onParameterDialogOpenChange: Dispatch<SetStateAction<boolean>>;
    onNodeEditorTempSave: (
        content: string,
        dataSourceId?: number,
        dataSourceType?: string,
        hiveConf?: Record<string, string>,
    ) => void;
    onTransferNodeDraftChange: (transferDraft: TransferConfig, state: TransferNodeDraftState) => void;
}

export function OfflineWorkbenchDialogs({
    groupId,
    repoTree,
    currentUserId,
    canWrite,
    defaultTimezone,
    dependencyDialogOpen,
    parameterDialogOpen,
    session,
    repositoryWorkflow,
    treeMutations,
    publishWorkflow,
    versionWorkflow,
    onlineMode,
    onDependencyDialogOpenChange,
    onStageDependencyConfig,
    onParameterDialogOpenChange,
    onNodeEditorTempSave,
    onTransferNodeDraftChange,
}: OfflineWorkbenchDialogsProps) {
    const { flowEditing, flowExecutionAndSchedule } = session;
    const { activeFlowPath, flowDocument, draftSession, isDirty, flowCommitDirty } = flowEditing;
    const { repoStatus, remoteStatus, branchLabel } = repositoryWorkflow;

    return (
        <>
            <SaveConflictDialog
                open={flowEditing.saveConflictState !== null}
                pending={flowEditing.isSaveConflictPending}
                onOpenChange={(open) => {
                    if (!open) flowEditing.closeSaveConflict();
                }}
                onOverwrite={() => void flowEditing.overwriteSaveConflict()}
                onDiscardAndReload={() => void flowEditing.discardSaveConflict()}
            />

            <OfflineExecutionDialog
                open={flowExecutionAndSchedule.executionDialogOpen}
                executions={flowExecutionAndSchedule.executions}
                loading={flowExecutionAndSchedule.executionsLoading}
                detail={flowExecutionAndSchedule.executionDetail}
                detailLoading={flowExecutionAndSchedule.executionDetailLoading}
                activeExecutionId={flowExecutionAndSchedule.activeExecutionId}
                actionPending={flowExecutionAndSchedule.executionActionPending}
                requestedByFilter={flowExecutionAndSchedule.executionRequestedByFilter}
                currentUserId={currentUserId}
                onOpenChange={(open) => flowExecutionAndSchedule.setExecutionDialogOpen(open)}
                onRefresh={() => void flowExecutionAndSchedule.refreshExecutions(flowExecutionAndSchedule.activeExecutionId)}
                onSelectExecution={(executionId) => void flowExecutionAndSchedule.loadExecutionDetail(executionId)}
                onStopAll={() => void flowExecutionAndSchedule.stopAllExecutions()}
                onRequestedByFilterChange={(requestedBy) => {
                    flowExecutionAndSchedule.setExecutionRequestedByFilter(requestedBy);
                    void flowExecutionAndSchedule.refreshExecutions(flowExecutionAndSchedule.activeExecutionId, requestedBy);
                }}
            />

            <ExecutionTimeContextDialog
                open={flowExecutionAndSchedule.executionContextDialogOpen}
                timezone={
                    flowExecutionAndSchedule.executionTimeRequirement.timezone
                    || flowDocument?.runtimeTimezone
                    || flowDocument?.schedule?.timezone
                    || defaultTimezone
                }
                parameterKeys={flowExecutionAndSchedule.executionTimeRequirement.parameterKeys}
                definitions={flowDocument?.parameterBinding?.definitions}
                plannedTime={flowExecutionAndSchedule.plannedTime}
                parameterOverrides={flowExecutionAndSchedule.parameterOverrides}
                pending={flowExecutionAndSchedule.executionSubmitting}
                onOpenChange={flowExecutionAndSchedule.setExecutionContextDialogOpen}
                onPlannedTimeChange={flowExecutionAndSchedule.setPlannedTime}
                onParameterOverridesChange={flowExecutionAndSchedule.setParameterOverrides}
                onConfirm={() => void flowExecutionAndSchedule.confirmExecution()}
            />

            <DependencyAwareScheduleDialog
                groupId={groupId}
                path={activeFlowPath}
                dependencyConfig={flowDocument?.dependencyConfig}
                savedPeriod={draftSession?.baseDocument.schedule?.period ?? null}
                open={onlineMode.canvasMode === 'dev' && flowExecutionAndSchedule.scheduleDialogOpen}
                schedule={flowExecutionAndSchedule.schedule}
                cron={flowExecutionAndSchedule.scheduleCron || ''}
                period={flowExecutionAndSchedule.schedulePeriod}
                timezone={flowExecutionAndSchedule.scheduleTimezone || ''}
                saving={flowExecutionAndSchedule.scheduleSaving}
                flowId={flowDocument?.flowId ?? null}
                hasRemote={remoteStatus?.hasRemote ?? repoStatus?.hasRemote ?? true}
                hasLocalOrUnpushedChanges={isDirty || !!repoStatus?.dirty || !!repoStatus?.ahead}
                onOpenChange={(open) => {
                    flowExecutionAndSchedule.setScheduleDialogOpen(open);
                    if (open && activeFlowPath) {
                        void flowExecutionAndSchedule.loadScheduleSnapshot(activeFlowPath);
                    }
                }}
                onPeriodChange={flowExecutionAndSchedule.changeSchedulePeriod}
                onSave={() => void flowExecutionAndSchedule.stageSchedule()}
                onToggle={(enabled) => void flowExecutionAndSchedule.toggleSchedule(enabled)}
            />

            {onlineMode.canvasMode === 'dev' && dependencyDialogOpen && groupId && flowDocument && flowDocument.groupId === groupId ? (
                <DependencyDialog
                    key={`${groupId}:${activeFlowPath}`}
                    groupId={groupId}
                    document={flowDocument}
                    canWrite={canWrite}
                    onClose={() => onDependencyDialogOpenChange(false)}
                    onStage={onStageDependencyConfig}
                />
            ) : null}

            {groupId && flowDocument ? (
                <FlowParameterDialog
                    open={onlineMode.canvasMode === 'dev' && parameterDialogOpen}
                    groupId={groupId}
                    binding={flowDocument.parameterBinding}
                    onOpenChange={onParameterDialogOpenChange}
                    onStage={session.stageParameterBinding}
                />
            ) : null}

            {groupId && activeFlowPath ? (
                <OfflineVersionHistoryDrawer
                    groupId={groupId}
                    path={activeFlowPath}
                    open={versionWorkflow.versionHistoryOpen}
                    canWrite={canWrite}
                    onOpenChange={versionWorkflow.setVersionHistoryOpen}
                    onCompare={(base, target) => void versionWorkflow.handleCompareVersions(base, target)}
                    onRollback={(selection) => versionWorkflow.setRollbackTarget(selection)}
                />
            ) : null}

            {groupId && activeFlowPath && versionWorkflow.versionCompare ? (
                <OfflineVersionCompareDialog
                    groupId={groupId}
                    path={activeFlowPath}
                    base={versionWorkflow.versionCompare.base}
                    target={versionWorkflow.versionCompare.target}
                    open={versionWorkflow.versionCompare.open}
                    canWrite={canWrite}
                    onOpenChange={(open) => versionWorkflow.setVersionCompare((current) => (current ? { ...current, open } : null))}
                    onBeforeLoadWorktree={versionWorkflow.ensureWorktreeFlushed}
                    onRollback={(selection) => versionWorkflow.setRollbackTarget(selection)}
                />
            ) : null}

            <OfflineCommitDialogs
                flowCommitOpen={publishWorkflow.flowCommitDialogOpen}
                repoCommitOpen={publishWorkflow.repoCommitDialogOpen}
                commitMessage={publishWorkflow.commitMessage}
                committing={publishWorkflow.committing}
                flowDraftDirty={isDirty}
                flowCommitDirty={flowCommitDirty}
                repoDraftDirty={isDirty}
                repoDirty={!!repoStatus?.dirty}
                onFlowCommitOpenChange={(open) => {
                    publishWorkflow.setFlowCommitDialogOpen(open);
                    if (!open) publishWorkflow.setCommitMessage('');
                }}
                onRepoCommitOpenChange={(open) => {
                    publishWorkflow.setRepoCommitDialogOpen(open);
                    if (!open) publishWorkflow.setCommitMessage('');
                }}
                onCommitMessageChange={publishWorkflow.setCommitMessage}
                onCommitFlow={(mode) => void publishWorkflow.handleFlowCommit(mode)}
                onCommitAndPushFlow={(mode) => void publishWorkflow.handleFlowCommitAndPush(mode)}
                onCommitRepo={(mode) => void publishWorkflow.handleRepoCommit(mode)}
            />

            <OfflineFlowPushDialog
                open={publishWorkflow.flowPushDialogOpen}
                flowLabel={flowDocument?.flowId ?? activeFlowPath ?? ''}
                branchLabel={branchLabel}
                hasUncommittedChanges={isDirty || flowCommitDirty}
                pushing={publishWorkflow.pushingFlow}
                onClose={() => publishWorkflow.setFlowPushDialogOpen(false)}
                onConfirmPush={() => void publishWorkflow.handleConfirmPushCurrentFlow()}
            />

            <OfflineRepositoryDialogs
                pushDialogOpen={repositoryWorkflow.pushDialogOpen}
                pushLoading={repositoryWorkflow.pushLoading}
                onPushDialogOpenChange={repositoryWorkflow.setPushDialogOpen}
                onPush={() => void (async () => {
                    try {
                        await repositoryWorkflow.push();
                    } finally {
                        onlineMode.refreshDeployment();
                    }
                })()}
                discardBranchSwitchOpen={repositoryWorkflow.discardBranchSwitchOpen}
                branchSwitching={repositoryWorkflow.branchSwitching}
                pendingBranchSwitch={repositoryWorkflow.pendingBranchSwitch}
                onDiscardBranchSwitchOpenChange={repositoryWorkflow.setDiscardBranchSwitchOpen}
                onConfirmDiscardDraftAndSwitchBranch={repositoryWorkflow.confirmDiscardDraftAndSwitchBranch}
                rebuildDialogOpen={repositoryWorkflow.rebuildDialogOpen}
                rebuildLoading={repositoryWorkflow.rebuildLoading}
                onRebuildDialogOpenChange={repositoryWorkflow.setRebuildDialogOpen}
                onRebuildRemote={() => void (async () => {
                    try {
                        await repositoryWorkflow.rebuildRemote();
                    } finally {
                        onlineMode.refreshDeployment();
                    }
                })()}
            />

            <NodeEditorDialog
                open={onlineMode.canvasMode === 'dev' && flowEditing.nodeEditorOpen}
                activeNode={flowEditing.activeNode}
                groupId={groupId}
                content={flowEditing.nodeEditorContent}
                parameterDefinitions={flowDocument?.parameterBinding?.definitions}
                onOpenChange={flowEditing.setNodeEditorOpen}
                onTempSave={onNodeEditorTempSave}
                onContentChange={flowEditing.updateNodeEditorContent}
                onDraftChange={session.handleNodeEditorDraftChange}
                onTransferChange={onTransferNodeDraftChange}
            />

            <OfflineOnlineInspectionDialogs
                visible={onlineMode.canvasMode === 'online'}
                groupId={groupId}
                onlineDocument={onlineMode.onlineDocument}
                confirmedRevision={onlineMode.confirmedRevision}
                defaultTimezone={defaultTimezone}
                onlineScheduleResponse={onlineMode.onlineScheduleResponse}
                onlineActiveNode={onlineMode.onlineActiveNode}
                onlineNodeContent={onlineMode.onlineNodeContent}
                scheduleDialogOpen={onlineMode.onlineScheduleDialogOpen}
                dependencyDialogOpen={onlineMode.onlineDependencyDialogOpen}
                parameterDialogOpen={onlineMode.onlineParameterDialogOpen}
                nodeEditorOpen={onlineMode.onlineNodeEditorOpen}
                onScheduleDialogOpenChange={onlineMode.setOnlineScheduleDialogOpen}
                onDependencyDialogClose={() => onlineMode.setOnlineDependencyDialogOpen(false)}
                onParameterDialogOpenChange={onlineMode.setOnlineParameterDialogOpen}
                onNodeEditorOpenChange={onlineMode.setOnlineNodeEditorOpen}
            />

            <OfflineTreeActionDialogs
                repoTree={repoTree}
                canWrite={canWrite}
                createFlow={{
                    open: treeMutations.newFlowDialogOpen,
                    name: treeMutations.newFlowName,
                    parentPath: treeMutations.newFlowParentPath,
                    timezone: treeMutations.newFlowTimezone,
                    crossGroupDependency: treeMutations.newFlowCrossGroupDependency,
                    onCrossGroupDependencyChange: treeMutations.setNewFlowCrossGroupDependency,
                    pending: treeMutations.newFlowCreating,
                    onOpenChange: treeMutations.setNewFlowDialogOpen,
                    onNameChange: treeMutations.setNewFlowName,
                    onParentPathChange: treeMutations.setNewFlowParentPath,
                    onTimezoneChange: treeMutations.setNewFlowTimezone,
                    onSubmit: () => void treeMutations.handleCreateFlow(),
                }}
                createFolder={{
                    open: treeMutations.newFolderDialogOpen,
                    name: treeMutations.newFolderName,
                    parentPath: treeMutations.newFolderParentPath,
                    pending: treeMutations.newFolderCreating,
                    onOpenChange: treeMutations.setNewFolderDialogOpen,
                    onNameChange: treeMutations.setNewFolderName,
                    onParentPathChange: treeMutations.setNewFolderParentPath,
                    onSubmit: () => void treeMutations.handleCreateFolder(),
                }}
                deleteFlow={{
                    groupId,
                    path: treeMutations.deleteFlowPath,
                    error: treeMutations.deleteFlowError,
                    open: treeMutations.deleteFlowDialogOpen,
                    name: treeMutations.deleteFlowName,
                    pending: treeMutations.deleteFlowLoading,
                    onOpenChange: treeMutations.setDeleteFlowDialogOpen,
                    onSubmit: () => void treeMutations.handleDeleteFlow(),
                }}
                deleteFolder={{
                    open: treeMutations.deleteFolderDialogOpen,
                    name: treeMutations.deleteFolderName,
                    pending: treeMutations.deleteFolderLoading,
                    onOpenChange: treeMutations.setDeleteFolderDialogOpen,
                    onSubmit: () => void treeMutations.handleDeleteFolder(),
                }}
                renameFlow={{
                    open: treeMutations.renameFlowDialogOpen,
                    name: treeMutations.renameFlowName,
                    originalName: treeMutations.renameFlowOriginalName,
                    pending: treeMutations.renameFlowLoading,
                    onOpenChange: treeMutations.setRenameFlowDialogOpen,
                    onNameChange: treeMutations.setRenameFlowName,
                    onSubmit: () => void treeMutations.handleRenameFlow(),
                }}
                renameFolder={{
                    open: treeMutations.renameFolderDialogOpen,
                    name: treeMutations.renameFolderName,
                    originalName: treeMutations.renameFolderOriginalName,
                    pending: treeMutations.renameFolderLoading,
                    onOpenChange: treeMutations.setRenameFolderDialogOpen,
                    onNameChange: treeMutations.setRenameFolderName,
                    onSubmit: () => void treeMutations.handleRenameFolder(),
                }}
                contextMenu={{
                    open: treeMutations.contextMenuOpen,
                    position: treeMutations.contextMenuPosition,
                    node: treeMutations.contextMenuNode,
                    onOpenChange: treeMutations.setContextMenuOpen,
                    onCopyFlowName: (node) => void treeMutations.handleCopyFlowName(node),
                    onOpenNewFlow: treeMutations.openNewFlowDialogFromContext,
                    onOpenNewFolder: treeMutations.openNewFolderDialogFromContext,
                    onOpenRenameFlow: treeMutations.openRenameFlowDialogFromContext,
                    onOpenRenameFolder: treeMutations.openRenameFolderDialogFromContext,
                    onOpenDeleteFlow: treeMutations.openDeleteFlowDialogFromContext,
                    onOpenDeleteFolder: treeMutations.openDeleteFolderDialogFromContext,
                }}
            />

            <OfflineRollbackConfirmDialog
                rollbackTarget={versionWorkflow.rollbackTarget}
                rollingBack={versionWorkflow.rollingBack}
                savingFlow={flowEditing.savingFlow}
                dirtyWarningVisible={isDirty || flowCommitDirty}
                onClose={() => versionWorkflow.setRollbackTarget(null)}
                onCompareWithWorktree={versionWorkflow.handleCompareRollbackWithWorktree}
                onConfirmRollback={() => void versionWorkflow.handleConfirmRollback()}
            />
        </>
    );
}
