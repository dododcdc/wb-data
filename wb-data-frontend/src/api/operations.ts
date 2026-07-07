import request from '../utils/request';
import { groupScopedPath } from './groupScoped';

export interface OperationsExecutionListQuery {
    groupId: number;
    branch?: string | null;
    flowId?: string | null;
    status?: string | null;
    from?: string | null;
    to?: string | null;
    page?: number | null;
    pageSize?: number | null;
}

export interface OperationsExecutionListItem {
    id: string;
    namespace: string;
    flowId: string;
    branch: string;
    status: string;
    plannedAt: string | null;
    createdAt: string | null;
    startDate: string | null;
    endDate: string | null;
    durationMs: number | null;
    rerunnable: boolean;
}

export interface OperationsExecutionListResponse {
    branches: string[];
    selectedBranch: string | null;
    from: string | null;
    to: string | null;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    executions: OperationsExecutionListItem[];
}

export interface OperationsExecutionTaskRun {
    taskId: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    durationMs: number | null;
}

export interface OperationsExecutionDetail {
    id: string;
    namespace: string;
    flowId: string;
    branch: string;
    status: string;
    plannedAt: string | null;
    createdAt: string | null;
    startDate: string | null;
    endDate: string | null;
    durationMs: number | null;
    rerunnable: boolean;
    taskRuns: OperationsExecutionTaskRun[];
    inputs: Record<string, string>;
    labels: Record<string, string>;
}

export interface OperationsExecutionLogEntry {
    timestamp: string | null;
    taskId: string | null;
    level: string | null;
    message: string | null;
}

export interface OperationsExecutionRerunResponse {
    originalExecutionId: string;
    newExecutionId: string;
    namespace: string;
    flowId: string;
    status: string;
    createdAt: string | null;
}

function buildListSearchParams(query?: OperationsExecutionListQuery) {
    const params = new URLSearchParams();
    if (!query) return params;

    const entries: Array<[keyof OperationsExecutionListQuery, string | null | undefined]> = [
        ['branch', query.branch],
        ['flowId', query.flowId],
        ['status', query.status],
        ['from', query.from],
        ['to', query.to],
    ];

    for (const [key, value] of entries) {
        const normalized = value?.trim();
        if (normalized) params.set(key, normalized);
    }

    if (query.page != null) params.set('page', String(query.page));
    if (query.pageSize != null) params.set('pageSize', String(query.pageSize));

    return params;
}

export const listOperationsExecutions = (query: OperationsExecutionListQuery) => {
    const params = buildListSearchParams(query);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const path = groupScopedPath(query.groupId, '/operations/executions');
    return request.get<unknown, OperationsExecutionListResponse>(`${path}${suffix}`);
};

export const getOperationsExecution = (groupId: number, executionId: string) => {
    return request.get<unknown, OperationsExecutionDetail>(
        groupScopedPath(groupId, `/operations/executions/${encodeURIComponent(executionId)}`)
    );
};

export const getOperationsExecutionLogs = (groupId: number, executionId: string, taskId?: string | null) => {
    const params = new URLSearchParams();
    const normalizedTaskId = taskId?.trim();
    if (normalizedTaskId) params.set('taskId', normalizedTaskId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';

    return request.get<unknown, OperationsExecutionLogEntry[]>(
        `${groupScopedPath(groupId, `/operations/executions/${encodeURIComponent(executionId)}/logs`)}${suffix}`
    );
};

export const rerunOperationsExecution = (groupId: number, executionId: string) => {
    return request.post<unknown, OperationsExecutionRerunResponse>(
        groupScopedPath(groupId, `/operations/executions/${encodeURIComponent(executionId)}/rerun`),
        null
    );
};
