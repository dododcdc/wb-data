import { useCallback, useRef } from 'react';
import type { FlowParameterBinding, OfflineFlowDependencySettings } from '../../api/offline';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';
import { flattenFlowDocumentNodes, resolveFlowSelectedTaskIds } from './draft/flowDocumentMutations';
import { updateFlowDependencyDraft, updateFlowParameterBindingDraft } from './draft/flowDraftController';
import { useFlowEditingSession } from './draft/useFlowEditingSession';
import { useFlowExecutionAndSchedule } from './execution/useFlowExecutionAndSchedule';

interface UseOfflineWorkbenchSessionParams {
    groupId: number | null;
    canWrite: boolean;
    defaultTimezone: string;
    showFeedback: (payload: FeedbackPayload) => void;
    showSuccess: (title: string, detail?: string) => void;
    refreshRepoStatus: () => Promise<void>;
}

interface ScheduleLifecycleHandlers {
    loadScheduleSnapshot: (path: string) => Promise<void>;
    resetExecutionAndSchedule: () => void;
}

export function useOfflineWorkbenchSession({
    groupId,
    canWrite,
    defaultTimezone,
    showFeedback,
    showSuccess,
    refreshRepoStatus,
}: UseOfflineWorkbenchSessionParams) {
    const scheduleHandlersRef = useRef<ScheduleLifecycleHandlers>({
        loadScheduleSnapshot: () => Promise.resolve(),
        resetExecutionAndSchedule: () => undefined,
    });

    const loadScheduleSnapshot = useCallback(
        (path: string) => scheduleHandlersRef.current.loadScheduleSnapshot(path),
        [],
    );
    const resetExecutionAndSchedule = useCallback(() => {
        scheduleHandlersRef.current.resetExecutionAndSchedule();
    }, []);

    const flowEditing = useFlowEditingSession({
        groupId,
        loadScheduleSnapshot,
        showFeedback,
        refreshRepoStatus,
        resetExecutionAndSchedule,
    });

    const flowExecutionAndSchedule = useFlowExecutionAndSchedule({
        groupId,
        activeFlowPath: flowEditing.activeFlowPath,
        draftSession: flowEditing.draftSession,
        flowDocument: flowEditing.flowDocument,
        selectedTaskIds: flowEditing.selectedTaskIds,
        nodeEditorOpen: flowEditing.nodeEditorOpen,
        defaultTimezone,
        canvasNodesRef: flowEditing.canvasNodesRef,
        canvasEdgesRef: flowEditing.canvasEdgesRef,
        setDraftSession: flowEditing.setDraftSession,
        showFeedback,
    });

    scheduleHandlersRef.current = {
        loadScheduleSnapshot: flowExecutionAndSchedule.loadScheduleSnapshot,
        resetExecutionAndSchedule: flowExecutionAndSchedule.resetExecutionAndSchedule,
    };

    const {
        flowDocument,
        setSelectedTaskIds,
        stageNodeEditorDraft,
        setDraftSession,
    } = flowEditing;

    const toggleTaskSelection = useCallback((taskId: string) => {
        setSelectedTaskIds((current) => (current.includes(taskId)
            ? current.filter((item) => item !== taskId)
            : [...current, taskId]));
    }, [setSelectedTaskIds]);

    const replaceTaskSelection = useCallback((taskIds: string[]) => {
        setSelectedTaskIds(resolveFlowSelectedTaskIds(flowDocument, taskIds));
    }, [flowDocument, setSelectedTaskIds]);

    const selectAllNodes = useCallback((selected: boolean) => {
        setSelectedTaskIds(selected && flowDocument
            ? flattenFlowDocumentNodes(flowDocument).map((node) => node.taskId)
            : []);
    }, [flowDocument, setSelectedTaskIds]);

    const handleNodeEditorDraftChange = useCallback((
        content: string,
        dataSourceId?: number,
        dataSourceType?: string,
        hiveConf?: Record<string, string>,
    ) => {
        stageNodeEditorDraft(content, dataSourceId, dataSourceType, undefined, undefined, undefined, hiveConf);
    }, [stageNodeEditorDraft]);

    const stageDependencyConfig = useCallback((config: OfflineFlowDependencySettings) => {
        if (!canWrite) return;
        setDraftSession((current) => (current ? updateFlowDependencyDraft(current, config) : current));
        showSuccess('依赖配置已暂存', '自动保存后生效');
    }, [canWrite, setDraftSession, showSuccess]);

    const stageParameterBinding = useCallback((binding: FlowParameterBinding | null) => {
        setDraftSession((current) => (current ? updateFlowParameterBindingDraft(current, binding) : current));
        showSuccess(binding ? '参数组已暂存' : '已暂存解除绑定', '自动保存后生效');
    }, [setDraftSession, showSuccess]);

    return {
        flowEditing,
        flowExecutionAndSchedule,
        toggleTaskSelection,
        replaceTaskSelection,
        selectAllNodes,
        handleNodeEditorDraftChange,
        stageDependencyConfig,
        stageParameterBinding,
    };
}
