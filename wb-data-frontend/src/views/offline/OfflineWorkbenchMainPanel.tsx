import { ReactFlowProvider } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';

import type { OfflineFlowDocument } from '../../api/offline';
import { Button } from '../../components/ui/button';
import FlowCanvas from './FlowCanvas';
import { OfflineCanvasToolbar } from './OfflineCanvasToolbar';
import { OfflineNodePalette } from './OfflineNodePalette';

interface OfflineWorkbenchMainPanelProps {
    activeFlowPath: string | null;
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
    committing: boolean;
    staleDraft: boolean;
    draftSaveState: 'idle' | 'saving' | 'saved' | 'error';
    draftSavedAt: number | null;
    draftSaveError: string | null;
    onSelectAllNodes: (selected: boolean) => void;
    onOpenFlowCommitDialog: () => void;
    onOpenScheduleDialog: () => void;
    onOpenDependencyDialog: () => void;
    onOpenParameterDialog: () => void;
    onExecute: () => void;
    onOpenExecutionDialog: () => void;
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

export function OfflineWorkbenchMainPanel({
    activeFlowPath,
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
    committing,
    staleDraft,
    draftSaveState,
    draftSavedAt,
    draftSaveError,
    onSelectAllNodes,
    onOpenFlowCommitDialog,
    onOpenScheduleDialog,
    onOpenDependencyDialog,
    onOpenParameterDialog,
    onExecute,
    onOpenExecutionDialog,
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

    return (
        <main className="offline-main-panel h-full animate-enter animate-enter-delay-1">
            <OfflineCanvasToolbar
                activeFlowPath={activeFlowPath}
                canWrite={canWrite}
                canConfigureParameters={canConfigureParameters}
                parameterBindingStatus={flowDocument.parameterBinding?.status}
                timezone={timezone}
                nodeCount={nodeCount}
                selectedNodeCount={selectedTaskIds.length}
                dirty={dirty}
                commitDirty={commitDirty}
                committing={committing}
                draftSaveState={draftSaveState}
                draftSavedAt={draftSavedAt}
                draftSaveError={draftSaveError}
                onSelectAll={onSelectAllNodes}
                onCommit={onOpenFlowCommitDialog}
                onOpenSchedule={onOpenScheduleDialog}
                onOpenDependencies={onOpenDependencyDialog}
                onOpenParameters={onOpenParameterDialog}
                onExecute={onExecute}
                onOpenExecutions={onOpenExecutionDialog}
            />

            <section className="offline-canvas-stage">
                <section className="offline-canvas-board">
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
                </section>
                <OfflineNodePalette disabled={!canWrite} />
            </section>
        </main>
    );
}
