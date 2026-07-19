import type { RefCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';

import type { OfflineFlowDocument, OfflineFlowNodeKind } from '../../api/offline';
import { Button } from '../../components/ui/button';
import FlowCanvas from './FlowCanvas';
import { OfflineCanvasToolbar } from './OfflineCanvasToolbar';

interface OfflineWorkbenchMainPanelProps {
    activeFlowPath: string | null;
    flowDocument: OfflineFlowDocument | null;
    canWrite: boolean;
    nodeCount: number;
    selectedTaskIds: string[];
    activeNodeId: string | null;
    nodeIssues: Record<string, string | null>;
    nodeStatuses: Record<string, string>;
    dirty: boolean;
    saving: boolean;
    commitDirty: boolean;
    committing: boolean;
    staleDraft: boolean;
    canvasBoardRef: RefCallback<HTMLElement>;
    onSelectAllNodes: (selected: boolean) => void;
    onSaveFlow: () => void;
    onOpenFlowCommitDialog: () => void;
    onOpenScheduleDialog: () => void;
    onExecute: () => void;
    onOpenExecutionDialog: () => void;
    onAddNodeAtCanvasCenter: (kind: OfflineFlowNodeKind) => void;
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
    nodeCount,
    selectedTaskIds,
    activeNodeId,
    nodeIssues,
    nodeStatuses,
    dirty,
    saving,
    commitDirty,
    committing,
    staleDraft,
    canvasBoardRef,
    onSelectAllNodes,
    onSaveFlow,
    onOpenFlowCommitDialog,
    onOpenScheduleDialog,
    onExecute,
    onOpenExecutionDialog,
    onAddNodeAtCanvasCenter,
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
                    <p>从左侧项目树选择一个 Flow</p>
                </div>
            </main>
        );
    }

    return (
        <main className="offline-main-panel h-full animate-enter animate-enter-delay-1">
            <OfflineCanvasToolbar
                activeFlowPath={activeFlowPath}
                canWrite={canWrite}
                nodeCount={nodeCount}
                selectedNodeCount={selectedTaskIds.length}
                dirty={dirty}
                saving={saving}
                commitDirty={commitDirty}
                committing={committing}
                onSelectAll={onSelectAllNodes}
                onSave={onSaveFlow}
                onCommit={onOpenFlowCommitDialog}
                onOpenSchedule={onOpenScheduleDialog}
                onExecute={onExecute}
                onOpenExecutions={onOpenExecutionDialog}
                onAddNode={onAddNodeAtCanvasCenter}
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
                        <Button type="button" variant="outline" size="sm" onClick={onDiscardStaleDraft}>
                            加载最新内容
                        </Button>
                        <Button type="button" size="sm" onClick={onRestoreStaleDraft}>
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
        </main>
    );
}
