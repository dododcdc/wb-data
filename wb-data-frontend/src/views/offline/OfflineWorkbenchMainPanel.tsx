import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, AlertTriangle, GitCommitHorizontal, LoaderCircle, RotateCcw } from 'lucide-react';

import type { GitSyncConfig } from '../../api/gitSettings';
import type { OfflineFlowDocument } from '../../api/offline';
import { Button } from '../../components/ui/button';
import { resolveDeploymentStatus } from './version/deploymentStatus';
import FlowCanvas from './canvas/FlowCanvas';
import { OfflineCanvasToolbar } from './canvas/OfflineCanvasToolbar';
import { OfflineNodePalette } from './canvas/OfflineNodePalette';
import type { CanvasMode, OnlineSnapshotStatus } from './version/useOnlineFlowSnapshot';

const NOOP = () => undefined;

interface OfflineWorkbenchMainPanelProps {
    activeFlowPath: string | null;
    groupId: number | null;
    branch: string | null;
    canvasMode?: CanvasMode;
    onCanvasModeChange?: (mode: CanvasMode) => void;
    onlineStatus?: OnlineSnapshotStatus;
    onlineDocument?: OfflineFlowDocument | null;
    onlineRevision?: string | null;
    deploymentConfig?: GitSyncConfig | null;
    onlineError?: string | null;
    onRetryOnlineSnapshot?: () => void;
    onlineActiveNodeId?: string | null;
    onSelectOnlineNode?: (nodeId: string | null) => void;
    onOpenOnlineNodeEditor?: (nodeId: string) => void;
    flowDocument: OfflineFlowDocument | null;
    canWrite: boolean;
    canConfigureParameters: boolean;
    timezone?: string | null;
    nodeCount: number;
    selectedTaskIds: string[];
    activeNodeId: string | null;
    nodeIssues: Record<string, string | null>;
    nodeStatuses: Record<string, string>;
    dirty: boolean;
    commitDirty: boolean;
    flowAhead?: boolean;
    committing: boolean;
    pushingFlow?: boolean;
    staleDraft: boolean;
    draftSaveState: 'idle' | 'saving' | 'saved' | 'error';
    draftSavedAt: number | null;
    draftSaveError: string | null;
    onSelectAllNodes: (selected: boolean) => void;
    onOpenFlowCommitDialog: () => void;
    onOpenFlowPushDialog?: () => void;
    onOpenScheduleDialog: () => void;
    onOpenDependencyDialog: () => void;
    onOpenParameterDialog: () => void;
    onExecute: () => void;
    onOpenExecutionDialog: () => void;
    onOpenVersions: () => void;
    onDiscardStaleDraft: () => void;
    onRestoreStaleDraft: () => void;
    onNodesChange: Parameters<typeof FlowCanvas>[0]['onNodesChange'];
    onEdgesChange: Parameters<typeof FlowCanvas>[0]['onEdgesChange'];
    onNodeLayoutCommit: Parameters<typeof FlowCanvas>[0]['onNodeLayoutCommit'];
    onSelectNode: Parameters<typeof FlowCanvas>[0]['onSelectNode'];
    onToggleTaskSelection: Parameters<typeof FlowCanvas>[0]['onToggleTaskSelection'];
    onReplaceTaskSelection: Parameters<typeof FlowCanvas>[0]['onReplaceTaskSelection'];
    onDoubleClickNode: Parameters<typeof FlowCanvas>[0]['onDoubleClickNode'];
    onAddNode: Parameters<typeof FlowCanvas>[0]['onAddNode'];
    onRenameNode: Parameters<typeof FlowCanvas>[0]['onRenameNode'];
}

function renderUnconfirmedCopy(deploymentConfig: GitSyncConfig | null | undefined) {
    if (!deploymentConfig) {
        return {
            title: '当前分支尚未配置线上同步部署',
            detail: '未检测到当前分支的 Kestra Git Sync 配置，无法确定线上发布版本。',
        };
    }
    const status = resolveDeploymentStatus(deploymentConfig);
    if (status?.tone === 'pending') {
        return {
            title: '线上部署同步中',
            detail: 'Kestra 同步执行尚未结束，待取得可信部署证据后将展示已确认的线上快照。',
        };
    }
    if (deploymentConfig.lastSyncStatus === 'FAILED') {
        return {
            title: '最近一次同步失败，暂无已确认线上快照',
            detail: deploymentConfig.lastSyncMessage
                || '最近一次 Kestra 同步失败，实际部署内容需要重新确认。为避免误导，暂不展示未确认的线上内容。',
        };
    }
    return {
        title: '暂无已确认的线上快照',
        detail: '尚未取得可信的 Kestra 部署证据（状态未知或未确认部署）。线上模式仅展示已确认部署的历史快照。',
    };
}

export function OfflineWorkbenchMainPanel({
    activeFlowPath,
    groupId,
    branch,
    canvasMode = 'dev',
    onCanvasModeChange,
    onlineStatus = 'idle',
    onlineDocument = null,
    onlineRevision = null,
    deploymentConfig,
    onlineError = null,
    onRetryOnlineSnapshot,
    onlineActiveNodeId = null,
    onSelectOnlineNode,
    onOpenOnlineNodeEditor,
    flowDocument,
    canWrite,
    canConfigureParameters,
    timezone,
    nodeCount,
    selectedTaskIds,
    activeNodeId,
    nodeIssues,
    nodeStatuses,
    dirty,
    commitDirty,
    flowAhead = false,
    committing,
    pushingFlow = false,
    staleDraft,
    draftSaveState,
    draftSavedAt,
    draftSaveError,
    onSelectAllNodes,
    onOpenFlowCommitDialog,
    onOpenFlowPushDialog,
    onOpenScheduleDialog,
    onOpenDependencyDialog,
    onOpenParameterDialog,
    onExecute,
    onOpenExecutionDialog,
    onOpenVersions,
    onDiscardStaleDraft,
    onRestoreStaleDraft,
    onNodesChange,
    onEdgesChange,
    onNodeLayoutCommit,
    onSelectNode,
    onToggleTaskSelection,
    onReplaceTaskSelection,
    onDoubleClickNode,
    onAddNode,
    onRenameNode,
}: OfflineWorkbenchMainPanelProps) {
    if (!activeFlowPath || !flowDocument) {
        return (
            <main className="offline-main-panel h-full animate-enter animate-enter-delay-1">
                <div className="offline-empty-state">
                    <p>从左侧项目树选择一个任务</p>
                </div>
            </main>
        );
    }

    const isOnlineMode = canvasMode === 'online';
    const hasOnlineDocument = Boolean(onlineDocument);
    const displayedTimezone = isOnlineMode
        ? (onlineDocument ? (onlineDocument.runtimeTimezone || onlineDocument.schedule?.timezone || timezone) : null)
        : timezone;
    const displayedParameterBindingStatus = isOnlineMode
        ? onlineDocument?.parameterBinding?.status
        : flowDocument.parameterBinding?.status;
    const unconfirmedCopy = isOnlineMode && onlineStatus === 'unconfirmed'
        ? renderUnconfirmedCopy(deploymentConfig)
        : null;

    return (
        <main className="offline-main-panel h-full animate-enter animate-enter-delay-1">
            <OfflineCanvasToolbar
                activeFlowPath={activeFlowPath}
                groupId={groupId}
                branch={branch}
                canvasMode={canvasMode}
                onCanvasModeChange={onCanvasModeChange}
                deploymentConfig={deploymentConfig}
                hasOnlineDocument={hasOnlineDocument}
                canWrite={canWrite}
                canConfigureParameters={canConfigureParameters}
                parameterBindingStatus={displayedParameterBindingStatus}
                timezone={displayedTimezone}
                nodeCount={isOnlineMode ? 0 : nodeCount}
                selectedNodeCount={isOnlineMode ? 0 : selectedTaskIds.length}
                dirty={dirty}
                commitDirty={commitDirty}
                flowAhead={flowAhead}
                committing={committing}
                pushingFlow={pushingFlow}
                draftSaveState={draftSaveState}
                draftSavedAt={draftSavedAt}
                draftSaveError={draftSaveError}
                onSelectAll={onSelectAllNodes}
                onCommit={onOpenFlowCommitDialog}
                onPushFlow={onOpenFlowPushDialog}
                onOpenSchedule={onOpenScheduleDialog}
                onOpenDependencies={onOpenDependencyDialog}
                onOpenParameters={onOpenParameterDialog}
                onExecute={onExecute}
                onOpenExecutions={onOpenExecutionDialog}
                onOpenVersions={onOpenVersions}
            />

            <section className="offline-canvas-stage">
                <section className="offline-canvas-board">
                    {isOnlineMode ? (
                        onlineStatus === 'ready' && onlineDocument ? (
                            <ReactFlowProvider key={`online:${activeFlowPath}:${onlineRevision ?? ''}`}>
                                <FlowCanvas
                                    readOnly
                                    flowDocument={onlineDocument}
                                    selectedTaskIds={[]}
                                    activeNodeId={onlineActiveNodeId}
                                    nodeIssues={{}}
                                    nodeStatuses={{}}
                                    onNodesChange={NOOP}
                                    onEdgesChange={NOOP}
                                    onNodeLayoutCommit={NOOP}
                                    onSelectNode={onSelectOnlineNode ?? NOOP}
                                    onToggleTaskSelection={NOOP}
                                    onReplaceTaskSelection={NOOP}
                                    onDoubleClickNode={onOpenOnlineNodeEditor ?? NOOP}
                                    onAddNode={NOOP}
                                    onRenameNode={NOOP}
                                />
                            </ReactFlowProvider>
                        ) : (
                            <div className="offline-online-status-panel" role={onlineStatus === 'error' ? 'alert' : 'status'}>
                                {onlineStatus === 'error' ? (
                                    <>
                                        <AlertCircle size={22} className="offline-online-status-icon is-error" aria-hidden="true" />
                                        <h3>线上快照加载失败</h3>
                                        <p>{onlineError || '请检查网络连接或后端状态后重试。'}</p>
                                        <div className="offline-online-status-actions">
                                            {onRetryOnlineSnapshot ? (
                                                <Button type="button" variant="outline" size="sm" onClick={onRetryOnlineSnapshot}>
                                                    <RotateCcw size={13} aria-hidden="true" />
                                                    重试
                                                </Button>
                                            ) : null}
                                            {onCanvasModeChange ? (
                                                <Button type="button" size="sm" onClick={() => onCanvasModeChange('dev')}>
                                                    返回开发模式
                                                </Button>
                                            ) : null}
                                        </div>
                                    </>
                                ) : onlineStatus === 'not-in-revision' ? (
                                    <>
                                        <GitCommitHorizontal size={22} className="offline-online-status-icon" aria-hidden="true" />
                                        <h3>当前任务尚未存在于已确认线上版本</h3>
                                        <p>
                                            当前分支已确认线上提交为 <code>{onlineRevision ? onlineRevision.slice(0, 7) : '—'}</code>，该提交中不包含此任务。
                                        </p>
                                        <div className="offline-online-status-actions">
                                            {onRetryOnlineSnapshot ? (
                                                <Button type="button" variant="outline" size="sm" onClick={onRetryOnlineSnapshot}>
                                                    <RotateCcw size={13} aria-hidden="true" />
                                                    重新检查
                                                </Button>
                                            ) : null}
                                            {onCanvasModeChange ? (
                                                <Button type="button" size="sm" onClick={() => onCanvasModeChange('dev')}>
                                                    返回开发模式
                                                </Button>
                                            ) : null}
                                        </div>
                                    </>
                                ) : onlineStatus === 'unconfirmed' && unconfirmedCopy ? (
                                    <>
                                        <AlertTriangle size={22} className="offline-online-status-icon is-warning" aria-hidden="true" />
                                        <h3>{unconfirmedCopy.title}</h3>
                                        <p>{unconfirmedCopy.detail}</p>
                                        <div className="offline-online-status-actions">
                                            {onRetryOnlineSnapshot ? (
                                                <Button type="button" variant="outline" size="sm" onClick={onRetryOnlineSnapshot}>
                                                    <RotateCcw size={13} aria-hidden="true" />
                                                    重新检查
                                                </Button>
                                            ) : null}
                                            {onCanvasModeChange ? (
                                                <Button type="button" size="sm" onClick={() => onCanvasModeChange('dev')}>
                                                    返回开发模式
                                                </Button>
                                            ) : null}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <LoaderCircle size={20} className="offline-spin offline-online-status-icon" aria-hidden="true" />
                                        <h3>{onlineStatus === 'loading' ? '正在加载已确认线上快照…' : '正在检查线上部署状态…'}</h3>
                                        <p>线上模式以只读方式呈现最近一次已确认部署的快照内容。</p>
                                    </>
                                )}
                            </div>
                        )
                    ) : (
                        <>
                            {staleDraft ? (
                                <div className="offline-conflict-banner" role="alert">
                                    <div className="offline-conflict-copy">
                                        <AlertTriangle size={15} className="offline-conflict-icon" />
                                        <div className="offline-conflict-message">
                                            <strong>发现未保存的本地恢复稿</strong>
                                            <p>当前文件也有更新。你可以继续恢复稿，或加载仓库最新内容。</p>
                                        </div>
                                    </div>
                                    <div className="offline-conflict-actions">
                                        <Button type="button" variant="outline" size="sm" onClick={onDiscardStaleDraft} className="h-7 px-2.5 text-xs">
                                            加载最新内容
                                        </Button>
                                        <Button type="button" size="sm" onClick={onRestoreStaleDraft} className="h-7 px-2.5 text-xs">
                                            继续恢复稿
                                        </Button>
                                    </div>
                                </div>
                            ) : null}

                            <ReactFlowProvider key={activeFlowPath}>
                                <FlowCanvas
                                    flowDocument={flowDocument}
                                    selectedTaskIds={selectedTaskIds}
                                    activeNodeId={activeNodeId}
                                    nodeIssues={nodeIssues}
                                    nodeStatuses={nodeStatuses}
                                    onNodesChange={onNodesChange}
                                    onEdgesChange={onEdgesChange}
                                    onNodeLayoutCommit={onNodeLayoutCommit}
                                    onSelectNode={onSelectNode}
                                    onToggleTaskSelection={onToggleTaskSelection}
                                    onReplaceTaskSelection={onReplaceTaskSelection}
                                    onDoubleClickNode={onDoubleClickNode}
                                    onAddNode={onAddNode}
                                    onRenameNode={onRenameNode}
                                />
                            </ReactFlowProvider>
                        </>
                    )}
                </section>
                {!isOnlineMode ? <OfflineNodePalette disabled={!canWrite} /> : null}
            </section>
        </main>
    );
}
