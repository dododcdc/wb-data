import type { FeedbackPayload } from '../../hooks/useOperationFeedback';
import type { NodeEditorDataSourceOption } from './useNodeEditorDataSources';
import type { OfflineFlowDocument, OfflineFlowNode, OfflineFlowNodeKind } from '../../api/offline';
import { getAllowedDataSourceTypes, getOfflineNodeKindLabel, isSqlEditorNodeKind } from './offlineNodeKinds';

export function buildNodeEditorDataSourceOptions(options: NodeEditorDataSourceOption[]) {
    return options;
}

export function validateSqlNodeDataSourceRequirement({
    kind,
    dataSourceId,
    dataSourceType,
    strict,
}: {
    kind: OfflineFlowNodeKind;
    dataSourceId?: number;
    dataSourceType?: string;
    strict: boolean;
}): {
    allowed: boolean;
    feedback: FeedbackPayload | null;
} {
    if (!isSqlEditorNodeKind(kind)) {
        return { allowed: true, feedback: null };
    }

    const allowedTypes = getAllowedDataSourceTypes(kind);
    const kindLabel = getOfflineNodeKindLabel(kind);

    if (dataSourceId && dataSourceType && !allowedTypes.includes(dataSourceType.toUpperCase())) {
        return {
            allowed: false,
            feedback: {
                tone: 'error',
                title: '数据源类型不匹配',
                detail: kind === 'SQL'
                    ? 'SQL 节点仅支持 MySQL、PostgreSQL、StarRocks 数据源。'
                    : 'HiveSQL 节点只能绑定 Hive 数据源。',
            },
        };
    }

    if (dataSourceId) {
        return { allowed: true, feedback: null };
    }

    if (strict) {
        return {
            allowed: false,
            feedback: {
                tone: 'error',
                title: '请先选择数据源',
                detail: `${kindLabel} 节点在保存或提交前必须绑定数据源。`,
            },
        };
    }

    return {
        allowed: true,
        feedback: {
            tone: 'info',
            title: '建议选择数据源',
            detail: `当前 ${kindLabel} 节点暂未绑定数据源，后续保存或提交前必须补齐。`,
        },
    };
}

export function findFirstNodeWithInvalidDataSource(document: OfflineFlowDocument | null, nodeOverride?: {
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

    return nodes.find((node) => {
        const validation = validateSqlNodeDataSourceRequirement({
            kind: node.kind,
            dataSourceId: node.dataSourceId,
            dataSourceType: node.dataSourceType,
            strict: true,
        });
        return !validation.allowed;
    }) ?? null;
}
