import type { TransferConfig } from '@/types/transfer';
import request from '../../utils/request';
import { omitGroupId } from '../groupScoped';
import type { AssetOwnerSummary, OwnerStatus, TransferOwnerResult } from '../groupSettings';
import type { OfflineFlowDependencySettings } from './dependencies';
import type { OfflineFlowSchedule } from './schedules';
import { offlinePath } from './shared';

export interface OfflineFlowPublicationItem {
    publishRecordId: number;
    onlineVersion: number;
    afterSha: string;
    pushedAt: string | null;
    status: string;
    currentOnline: boolean;
}

export interface OfflineFlowVersionItem {
    revision: string;
    kind: 'DEVELOPMENT' | 'COMMIT';
    message: string | null;
    authorName: string | null;
    committedAt: string | null;
    dirty: boolean;
    publications: OfflineFlowPublicationItem[];
}

export interface OfflineFlowVersionHistoryResponse {
    branch: string;
    items: OfflineFlowVersionItem[];
    total: number;
    page: number;
    size: number;
}

export interface OfflineFlowFileSnapshot {
    path: string;
    sha256: string;
    size: number;
    content: string | null;
}

export interface OfflineFlowVersionSnapshot {
    revision: string;
    document: OfflineFlowDocument;
    files: OfflineFlowFileSnapshot[];
    nodeMetadata: Record<string, { referencedParameters: string[] }>;
}

export interface OfflineFlowContent {
    groupId: number;
    path: string;
    content: string;
    contentHash: string;
    fileUpdatedAt: number;
}

export type OfflineFlowNodeKind =
    | 'SQL'
    | 'MYSQL'
    | 'POSTGRESQL'
    | 'CLICKHOUSE'
    | 'HIVE_SQL'
    | 'SHELL'
    | 'TRANSFER';

export interface OfflineFlowNode {
    taskId: string;
    kind: OfflineFlowNodeKind;
    scriptPath?: string;
    scriptContent?: string;
    dataSourceId?: number;
    dataSourceType?: string;
    transfer?: TransferConfig;
    transferDraft?: TransferConfig;
    transferDraftValid?: boolean;
    hiveConf?: Record<string, string>;
}

export interface OfflineFlowEdge {
    source: string;
    target: string;
}

export interface NodePosition {
    x: number;
    y: number;
}

export interface OfflineFlowStage {
    stageId: string;
    parallel: boolean;
    nodes: OfflineFlowNode[];
}

export interface FlowParameterDefinitionSnapshot {
    key: string;
    valueSource: 'CONSTANT' | 'SYSTEM_TIME';
    constantValue?: string | null;
    format?: string | null;
    offsetDays: number;
    timeBasis?: 'PLANNED_TIME' | 'EXECUTION_START_TIME' | null;
    description?: string | null;
    sortOrder: number;
}

export interface FlowParameterBindingItem {
    parameterGroupId?: number | null;
    code: string;
    name?: string | null;
    boundVersion: number;
    currentVersion?: number | null;
    status: 'CURRENT' | 'OUTDATED' | 'ARCHIVED' | 'MISSING';
    definitions: FlowParameterDefinitionSnapshot[];
}

export interface FlowParameterBinding {
    parameterGroupId?: number | null;
    code: string;
    name?: string | null;
    boundVersion: number;
    currentVersion?: number | null;
    status: 'CURRENT' | 'OUTDATED' | 'ARCHIVED' | 'MISSING';
    definitions: FlowParameterDefinitionSnapshot[];
    bindings?: FlowParameterBindingItem[];
}

export interface FlowParameterBindingRequest {
    parameterGroupId?: number;
    expectedVersion?: number;
}

export interface OfflineFlowDocument {
    groupId: number;
    path: string;
    flowId: string;
    namespace: string;
    documentHash: string;
    documentUpdatedAt: number;
    runtimeTimezone?: string | null;
    stages: OfflineFlowStage[];
    edges: OfflineFlowEdge[];
    layout: Record<string, NodePosition>;
    schedule?: OfflineFlowSchedule | null;
    dependencyConfig?: OfflineFlowDependencySettings;
    parameterBinding?: FlowParameterBinding | null;
    ownerUserId?: number | null;
    ownerName?: string | null;
    ownerUsername?: string | null;
    ownerStatus?: OwnerStatus | null;
}

export interface SaveOfflineFlowRequest {
    groupId: number;
    path: string;
    content: string;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface SaveOfflineFlowNodeRequest {
    taskId: string;
    scriptContent?: string;
    kind: OfflineFlowNodeKind;
    scriptPath?: string;
    dataSourceId?: number;
    dataSourceType?: string;
    transfer?: TransferConfig;
    hiveConf?: Record<string, string>;
}

export interface SaveOfflineFlowStageRequest {
    stageId: string;
    nodes: SaveOfflineFlowNodeRequest[];
}

export interface SaveOfflineFlowEdgeRequest {
    source: string;
    target: string;
}

export interface SaveOfflineFlowDocumentRequest {
    groupId: number;
    path: string;
    documentHash: string;
    documentUpdatedAt: number;
    stages: SaveOfflineFlowStageRequest[];
    edges?: SaveOfflineFlowEdgeRequest[];
    layout?: Record<string, NodePosition>;
    schedule?: OfflineFlowSchedule;
    dependencyConfig?: OfflineFlowDependencySettings;
    parameterBinding?: FlowParameterBindingRequest | null;
    parameterBindings?: FlowParameterBindingRequest[] | null;
    runtimeTimezone: string;
    ownerUserId?: number | null;
}

export interface RollbackOfflineFlowRequest {
    groupId: number;
    path: string;
    revision: string;
    documentHash?: string;
    documentUpdatedAt?: number;
}

export interface RollbackOfflineFlowResponse {
    document: OfflineFlowDocument;
    warnings: string[];
    nodeIssues: Record<string, string>;
}

export const getOfflineFlowContent = (groupId: number, path: string) => {
    const params = new URLSearchParams({
        path,
    });
    return request.get<unknown, OfflineFlowContent>(`${offlinePath(groupId, '/flows/content')}?${params.toString()}`);
};

export const getOfflineFlowDocument = (groupId: number, path: string) => {
    const params = new URLSearchParams({
        path,
    });
    return request.get<unknown, OfflineFlowDocument>(`${offlinePath(groupId, '/flows/document')}?${params.toString()}`);
};

export const getOfflineFlowVersions = (
    groupId: number,
    path: string,
    options: { onlineOnly?: boolean; page?: number; size?: number } = {},
) => {
    const params = new URLSearchParams({
        path,
        onlineOnly: String(options.onlineOnly ?? false),
        page: String(options.page ?? 1),
        size: String(options.size ?? 50),
    });
    return request.get<unknown, OfflineFlowVersionHistoryResponse>(
        `${offlinePath(groupId, '/flows/versions')}?${params.toString()}`,
    );
};

export const getOfflineFlowSnapshot = (groupId: number, path: string, rev: string) => {
    const params = new URLSearchParams({ path, rev });
    return request.get<unknown, OfflineFlowVersionSnapshot>(
        `${offlinePath(groupId, '/flows/snapshot')}?${params.toString()}`,
    );
};

export const saveOfflineFlowContent = (payload: SaveOfflineFlowRequest) => {
    return request.put<unknown, OfflineFlowContent>(offlinePath(payload.groupId, '/flows/content'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const saveOfflineFlowDocument = (payload: SaveOfflineFlowDocumentRequest) => {
    return request.put<unknown, OfflineFlowDocument>(offlinePath(payload.groupId, '/flows/document'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const rollbackOfflineFlow = (payload: RollbackOfflineFlowRequest) => {
    return request.post<unknown, RollbackOfflineFlowResponse>(
        offlinePath(payload.groupId, '/flows/rollback'),
        omitGroupId(payload),
        {
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );
};

export const deleteOfflineFlow = (groupId: number, path: string) => {
    return request.delete(offlinePath(groupId, '/flows'), {
        data: { path },
        headers: { 'Content-Type': 'application/json' },
    });
};

export const moveOfflineFlow = (groupId: number, path: string, newPath: string) => {
    return request.post(offlinePath(groupId, '/flows/move'), { path, newPath }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export interface TransferOfflineFlowOwnerPayload {
    paths?: string[];
    fromOwnerUserId?: number;
    targetOwnerUserId: number;
}

export const getOfflineFlowOwners = (groupId: number) => {
    return request.get<unknown, AssetOwnerSummary[]>(offlinePath(groupId, '/flows/owners'));
};

export const transferOfflineFlowOwner = (groupId: number, payload: TransferOfflineFlowOwnerPayload) => {
    return request.post<unknown, TransferOwnerResult>(offlinePath(groupId, '/flows/transfer-owner'), payload, {
        headers: { 'Content-Type': 'application/json' },
    });
};
