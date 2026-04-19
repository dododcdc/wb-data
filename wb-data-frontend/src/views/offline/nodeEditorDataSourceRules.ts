import type { FeedbackPayload } from '../../hooks/useOperationFeedback';
import type { NodeEditorDataSourceOption } from './useNodeEditorDataSources';
import type { OfflineFlowDocument, OfflineFlowNode } from '../../api/offline';

export function buildNodeEditorDataSourceOptions(options: NodeEditorDataSourceOption[]) {
    return options;
}

export function validateSqlNodeDataSourceRequirement({
    kind,
    dataSourceId,
    strict,
}: {
    kind: 'SQL' | 'SHELL';
    dataSourceId?: number;
    strict: boolean;
}): {
    allowed: boolean;
    feedback: FeedbackPayload | null;
} {
    if (kind !== 'SQL' || dataSourceId) {
        return { allowed: true, feedback: null };
    }

    if (strict) {
        return {
            allowed: false,
            feedback: {
                tone: 'error',
                title: '请先选择数据源',
                detail: 'SQL 节点在保存或提交前必须绑定数据源。',
            },
        };
    }

    return {
        allowed: true,
        feedback: {
            tone: 'info',
            title: '建议选择数据源',
            detail: '当前 SQL 节点暂未绑定数据源，后续保存或提交前必须补齐。',
        },
    };
}

export function findFirstSqlNodeMissingDataSource(document: OfflineFlowDocument | null, nodeOverride?: {
    taskId: string;
    content: string;
    dataSourceId?: number;
    dataSourceType?: string;
}) {
    if (!document) {
        return null;
    }

    const nodes = document.stages.flatMap((stage) => stage.nodes).map((node) => {
        if (!nodeOverride || node.taskId !== nodeOverride.taskId) {
            return node;
        }
        return {
            ...node,
            dataSourceId: nodeOverride.dataSourceId,
            dataSourceType: nodeOverride.dataSourceType,
            scriptContent: nodeOverride.content,
        } satisfies OfflineFlowNode;
    });

    return nodes.find((node) => node.kind === 'SQL' && !node.dataSourceId) ?? null;
}
