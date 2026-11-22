import request from '../../utils/request';
import { omitGroupId } from '../groupScoped';
import type {
    NodePosition,
    SaveOfflineFlowEdgeRequest,
    SaveOfflineFlowStageRequest,
} from './flows';
import { offlinePath } from './shared';

export type OfflineExecutionMode = 'ALL' | 'SELECTED';

export interface DebugExecutionRequest {
    groupId: number;
    flowPath: string;
    content: string;
    selectedTaskIds: string[];
    mode: OfflineExecutionMode;
    parameterOverrides?: Record<string, string>;
    plannedTime?: string;
}

export interface SavedDebugExecutionRequest {
    groupId: number;
    flowPath: string;
    selectedTaskIds: string[];
    mode: OfflineExecutionMode;
    parameterOverrides?: Record<string, string>;
    plannedTime?: string;
}

export interface DebugDocumentExecutionRequest {
    groupId: number;
    flowPath: string;
    documentHash: string;
    documentUpdatedAt: number;
    stages: SaveOfflineFlowStageRequest[];
    edges: SaveOfflineFlowEdgeRequest[];
    layout: Record<string, NodePosition>;
    selectedTaskIds: string[];
    mode: OfflineExecutionMode;
    parameterOverrides?: Record<string, string>;
    plannedTime?: string;
}

export interface OfflineExecutionResponse {
    executionId: string;
    mode: string;
    flowPath: string;
    sourceRevision: string;
    status: string;
    createdAt: string;
}

export interface OfflineExecutionListItem {
    executionId: string;
    flowPath: string;
    displayName: string;
    requestedBy: number | null;
    mode: string;
    status: string;
    triggerType: string;
    startDate: string | null;
    endDate: string | null;
    durationMs: number | null;
    sourceRevision: string;
}

export interface OfflineExecutionTaskRun {
    taskId: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    durationMs?: number | null;
}

export interface ExecutionParameterValue {
    key: string;
    dataType: 'STRING' | 'INTEGER' | 'BOOLEAN' | 'DATE' | 'DATETIME';
    value: string | null;
    source: 'CONSTANT' | 'SYSTEM_TIME' | 'MANUAL_OVERRIDE' | 'EXPLICIT_INPUT' | 'RERUN';
}

export interface OfflineExecutionDetail {
    executionId: string;
    mode: string;
    flowPath: string;
    requestedBy: number | null;
    branch: string | null;
    sourceRevision: string;
    status: string;
    createdAt: string | null;
    startDate: string | null;
    endDate: string | null;
    taskRuns: OfflineExecutionTaskRun[];
    parameterResolutionStatus: 'NONE' | 'AVAILABLE' | 'PENDING' | 'UNAVAILABLE';
    parameters: ExecutionParameterValue[];
}

export interface OfflineExecutionScript {
    executionId: string;
    flowPath: string;
    content: string;
}

export interface OfflineExecutionLogEntry {
    timestamp: string | null;
    taskId: string | null;
    level: string | null;
    message: string | null;
}

export function buildExecutionListSearchParams(flowPath: string, requestedBy?: number | null) {
    const params = new URLSearchParams({
        flowPath,
    });
    if (requestedBy != null) {
        params.set('requestedBy', String(requestedBy));
    }
    return params;
}

export const createOfflineDebugExecution = (payload: DebugExecutionRequest) => {
    return request.post<unknown, OfflineExecutionResponse>(offlinePath(payload.groupId, '/executions/debug'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const createOfflineDocumentDebugExecution = (payload: DebugDocumentExecutionRequest) => {
    return request.post<unknown, OfflineExecutionResponse>(offlinePath(payload.groupId, '/executions/debug/document'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const createOfflineSavedDebugExecution = (payload: SavedDebugExecutionRequest) => {
    return request.post<unknown, OfflineExecutionResponse>(offlinePath(payload.groupId, '/executions/debug/current'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const listOfflineExecutions = (groupId: number, flowPath: string, requestedBy?: number | null) => {
    const params = buildExecutionListSearchParams(flowPath, requestedBy);
    return request.get<unknown, OfflineExecutionListItem[]>(`${offlinePath(groupId, '/executions')}?${params.toString()}`);
};

export const getOfflineExecution = (groupId: number, executionId: string) => {
    return request.get<unknown, OfflineExecutionDetail>(
        offlinePath(groupId, `/executions/${encodeURIComponent(executionId)}`)
    );
};

export const getOfflineExecutionLogs = (groupId: number, executionId: string, taskId?: string | null) => {
    const params = new URLSearchParams();
    if (taskId) params.set('taskId', taskId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return request.get<unknown, OfflineExecutionLogEntry[]>(
        `${offlinePath(groupId, `/executions/${encodeURIComponent(executionId)}/logs`)}${suffix}`
    );
};

export const getOfflineExecutionScript = (groupId: number, executionId: string) => {
    return request.get<unknown, OfflineExecutionScript>(
        offlinePath(groupId, `/executions/${encodeURIComponent(executionId)}/script`)
    );
};

export const stopOfflineExecution = (groupId: number, executionId: string) => {
    return request.post<unknown, null>(
        offlinePath(groupId, `/executions/${encodeURIComponent(executionId)}/stop`),
        null
    );
};

export const stopAllOfflineExecutions = (groupId: number, flowPath: string) => {
    const params = new URLSearchParams({
        flowPath,
    });
    return request.post<unknown, number>(`${offlinePath(groupId, '/executions/stop-all')}?${params.toString()}`, null);
};
