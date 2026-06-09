import request from '../utils/request';

export interface OperationsExecutionListQuery {
    groupId: number;
    branch?: string | null;
    flowId?: string | null;
    status?: string | null;
    from?: string | null;
    to?: string | null;
}

export interface OperationsExecutionListItem {
    id: string;
    namespace: string;
    flowId: string;
    branch: string;
    status: string;
    createdAt: string | null;
    startDate: string | null;
    endDate: string | null;
    durationMs: number | null;
    failureSummary: string | null;
    rerunnable: boolean;
}

export interface OperationsExecutionListResponse {
    branches: string[];
    selectedBranch: string | null;
    from: string | null;
    to: string | null;
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
    createdAt: string | null;
    startDate: string | null;
    endDate: string | null;
    durationMs: number | null;
    failureSummary: string | null;
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

    params.set('groupId', String(query.groupId));

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

    return params;
}

export const listOperationsExecutions = (query?: OperationsExecutionListQuery) => {
    const params = buildListSearchParams(query);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return request.get<unknown, OperationsExecutionListResponse>(`/api/v1/operations/executions${suffix}`);
};

export const getOperationsExecution = (groupId: number, executionId: string) => {
    const params = new URLSearchParams({ groupId: String(groupId) });
    return request.get<unknown, OperationsExecutionDetail>(
        `/api/v1/operations/executions/${encodeURIComponent(executionId)}?${params.toString()}`
    );
};

export const getOperationsExecutionLogs = (groupId: number, executionId: string, taskId?: string | null) => {
    const params = new URLSearchParams({ groupId: String(groupId) });
    const normalizedTaskId = taskId?.trim();
    if (normalizedTaskId) params.set('taskId', normalizedTaskId);

    return request.get<unknown, OperationsExecutionLogEntry[]>(
        `/api/v1/operations/executions/${encodeURIComponent(executionId)}/logs?${params.toString()}`
    );
};

export const rerunOperationsExecution = (groupId: number, executionId: string) => {
    const params = new URLSearchParams({ groupId: String(groupId) });
    return request.post<unknown, OperationsExecutionRerunResponse>(
        `/api/v1/operations/executions/${encodeURIComponent(executionId)}/rerun?${params.toString()}`,
        null
    );
};
