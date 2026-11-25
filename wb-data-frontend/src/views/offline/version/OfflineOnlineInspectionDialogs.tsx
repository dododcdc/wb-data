import type { OfflineFlowDocument, OfflineFlowNode, OfflineScheduleResponse } from '../../../api/offline';
import { NodeEditorDialog } from '../editor/NodeEditorDialog';
import { DependencyDialog } from '../schedule/DependencyDialog';
import { FlowParameterDialog } from '../schedule/FlowParameterDialog';
import { ScheduleDialog } from '../schedule/ScheduleDialog';

const NOOP = () => undefined;

interface OfflineOnlineInspectionDialogsProps {
    visible: boolean;
    groupId: number | null;
    onlineDocument: OfflineFlowDocument | null;
    confirmedRevision: string | null;
    defaultTimezone: string;
    onlineScheduleResponse: OfflineScheduleResponse | null;
    onlineActiveNode: OfflineFlowNode | null;
    onlineNodeContent: string;
    scheduleDialogOpen: boolean;
    dependencyDialogOpen: boolean;
    parameterDialogOpen: boolean;
    nodeEditorOpen: boolean;
    onScheduleDialogOpenChange: (open: boolean) => void;
    onDependencyDialogClose: () => void;
    onParameterDialogOpenChange: (open: boolean) => void;
    onNodeEditorOpenChange: (open: boolean) => void;
}

export function OfflineOnlineInspectionDialogs({
    visible,
    groupId,
    onlineDocument,
    confirmedRevision,
    defaultTimezone,
    onlineScheduleResponse,
    onlineActiveNode,
    onlineNodeContent,
    scheduleDialogOpen,
    dependencyDialogOpen,
    parameterDialogOpen,
    nodeEditorOpen,
    onScheduleDialogOpenChange,
    onDependencyDialogClose,
    onParameterDialogOpenChange,
    onNodeEditorOpenChange,
}: OfflineOnlineInspectionDialogsProps) {
    if (!visible || !groupId || !onlineDocument) {
        return null;
    }

    return (
        <>
            <ScheduleDialog
                open={scheduleDialogOpen}
                readOnly
                readOnlyRevision={confirmedRevision}
                schedule={onlineScheduleResponse}
                cron={onlineScheduleResponse?.cron ?? ''}
                period={onlineScheduleResponse?.period ?? 'DAILY'}
                timezone={onlineDocument.runtimeTimezone || onlineScheduleResponse?.timezone || defaultTimezone}
                retryEnabled={Boolean(onlineScheduleResponse?.retryEnabled)}
                retryCount={onlineScheduleResponse?.retryCount ?? 3}
                retryIntervalMinutes={onlineScheduleResponse?.retryIntervalMinutes ?? 5}
                saving={false}
                flowId={onlineDocument.flowId ?? null}
                onOpenChange={onScheduleDialogOpenChange}
                onPeriodChange={NOOP}
                onRetryChange={NOOP}
                onSave={NOOP}
                onToggle={NOOP}
            />

            {dependencyDialogOpen ? (
                <DependencyDialog
                    key={`online:${groupId}:${onlineDocument.path}:${confirmedRevision ?? ''}`}
                    groupId={groupId}
                    document={onlineDocument}
                    canWrite={false}
                    readOnly
                    readOnlyRevision={confirmedRevision}
                    onClose={onDependencyDialogClose}
                    onStage={NOOP}
                />
            ) : null}

            <FlowParameterDialog
                open={parameterDialogOpen}
                groupId={groupId}
                binding={onlineDocument.parameterBinding}
                readOnly
                readOnlyRevision={confirmedRevision}
                onOpenChange={onParameterDialogOpenChange}
                onStage={NOOP}
            />

            <NodeEditorDialog
                open={nodeEditorOpen}
                readOnly
                activeNode={onlineActiveNode}
                groupId={groupId}
                content={onlineNodeContent}
                parameterDefinitions={onlineDocument.parameterBinding?.definitions}
                onOpenChange={onNodeEditorOpenChange}
                onTempSave={NOOP}
                onContentChange={NOOP}
            />
        </>
    );
}
