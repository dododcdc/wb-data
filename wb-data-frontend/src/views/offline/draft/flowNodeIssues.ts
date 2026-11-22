import type { OfflineExecutionDetail, OfflineFlowDocument } from '../../../api/offline';
import { validateSqlNodeDataSourceRequirement } from '../editor/nodeEditorDataSourceRules';
import { flattenFlowDocumentNodes } from './flowDocumentMutations';

export function filterActiveRollbackIssues(
    flowDocument: OfflineFlowDocument | null,
    rollbackNodeIssues: Record<string, string>,
): Record<string, string> {
    if (!flowDocument) return {};
    const existingTaskIds = new Set(flattenFlowDocumentNodes(flowDocument).map((node) => node.taskId));
    const active: Record<string, string> = {};
    for (const [taskId, reason] of Object.entries(rollbackNodeIssues)) {
        if (existingTaskIds.has(taskId) && reason) {
            active[taskId] = reason;
        }
    }
    return active;
}

export function computeFlowNodeIssues(
    flowDocument: OfflineFlowDocument | null,
    activeRollbackIssues: Record<string, string>,
): Record<string, string | null> {
    if (!flowDocument) return {};
    const issues: Record<string, string | null> = {};
    flattenFlowDocumentNodes(flowDocument).forEach((node) => {
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
}

export function computeExecutionNodeStatuses(
    executionDetail: OfflineExecutionDetail | null | undefined,
): Record<string, string> {
    if (!executionDetail?.taskRuns) return {};
    const statuses: Record<string, string> = {};
    executionDetail.taskRuns.forEach((run) => {
        statuses[run.taskId] = run.status;
    });
    return statuses;
}
