import request from '../utils/request';
import { buildExecutionListSearchParams } from '../views/offline/executionFilters';

function buildGroupScopedPath(path: string, groupId: number) {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}groupId=${groupId}`;
}

export interface RemoteStatus {
    hasRemote: boolean;
    remoteUrl: string | null;
}

export interface PushResult {
    success: boolean;
    message: string;
    remoteUrl: string | null;
    remoteCreated: boolean;
}

export interface CommitResult {
    success: boolean;
    message: string;
}

export interface OfflineRepoStatus {
    groupId: number;
    repoPath: string;
    exists: boolean;
    gitInitialized: boolean;
    dirty: boolean;
    ahead: boolean;
    branch: string | null;
    headCommitId: string | null;
    headCommitMessage: string | null;
    headCommitAt: string | null;
}

export interface OfflineRepoTreeNode {
    id: string;
    kind: 'ROOT' | 'DIRECTORY' | 'FLOW';
    name: string;
    path: string;
    children: OfflineRepoTreeNode[];
}

export interface OfflineRepoTreeResponse {
    groupId: number;
    root: OfflineRepoTreeNode;
}

export interface OfflineFlowContent {
    groupId: number;
    path: string;
    content: string;
    contentHash: string;
    fileUpdatedAt: number;
}

export type OfflineFlowNodeKind = 'SQL' | 'HIVE_SQL' | 'SHELL';

export interface OfflineFlowNode {
    taskId: string;
    kind: OfflineFlowNodeKind;
    scriptPath: string;
    scriptContent: string;
    dataSourceId?: number;
    dataSourceType?: string;
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

export interface OfflineFlowDocument {
    groupId: number;
    path: string;
    flowId: string;
    namespace: string;
    documentHash: string;
    documentUpdatedAt: number;
    stages: OfflineFlowStage[];
    edges: OfflineFlowEdge[];
    layout: Record<string, NodePosition>;
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
    scriptContent: string;
    kind: OfflineFlowNodeKind;
    scriptPath: string;
    dataSourceId?: number;
    dataSourceType?: string;
}

export interface SaveOfflineFlowStageRequest {
    stageId: string;
    nodes: SaveOfflineFlowNodeRequest[];
}

export interface SaveOfflineFlowDocumentRequest {
    groupId: number;
    path: string;
    documentHash: string;
    documentUpdatedAt: number;
    stages: SaveOfflineFlowStageRequest[];
    edges?: SaveOfflineFlowEdgeRequest[];
    layout?: Record<string, NodePosition>;
}

export interface SaveOfflineFlowEdgeRequest {
    source: string;
    target: string;
}

export type OfflineExecutionMode = 'ALL' | 'SELECTED';

export interface DebugExecutionRequest {
    groupId: number;
    flowPath: string;
    content: string;
    selectedTaskIds: string[];
    mode: OfflineExecutionMode;
}

export interface SavedDebugExecutionRequest {
    groupId: number;
    flowPath: string;
    selectedTaskIds: string[];
    mode: OfflineExecutionMode;
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

export interface OfflineScheduleResponse {
    groupId: number;
    path: string;
    triggerId: string;
    cron: string;
    timezone: string | null;
    enabled: boolean;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface UpdateOfflineScheduleRequest {
    groupId: number;
    path: string;
    cron: string;
    timezone: string;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface UpdateOfflineScheduleStatusRequest {
    groupId: number;
    path: string;
    enabled: boolean;
    contentHash: string;
    fileUpdatedAt: number;
}

export const getOfflineRepoStatus = (groupId: number) => {
    return request.get<unknown, OfflineRepoStatus>(`/api/v1/offline/repo/status?groupId=${groupId}`);
};

export const getOfflineRepoTree = (groupId: number) => {
    return request.get<unknown, OfflineRepoTreeResponse>(`/api/v1/offline/repo/tree?groupId=${groupId}`);
};

export const getOfflineRepoRemote = (groupId: number) => {
    return request.get<unknown, RemoteStatus>(`/api/v1/offline/repo/remote?groupId=${groupId}`);
};

export const commitOfflineRepo = (groupId: number, message: string) => {
    return request.post<unknown, CommitResult>(buildGroupScopedPath('/api/v1/offline/repo/commit', groupId), { groupId, message }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const pushOfflineRepo = (groupId: number) => {
    return request.post<unknown, PushResult>(buildGroupScopedPath('/api/v1/offline/repo/push', groupId), { groupId }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const createOfflineFolder = (groupId: number, path: string) => {
    return request.post<unknown, null>(buildGroupScopedPath('/api/v1/offline/repo/folder', groupId), { groupId, path }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const testGitHubConnection = (provider: string, username: string, token: string, baseUrl: string, owner: string) => {
    return request.post<unknown, string>('/api/v1/git/config/test', { provider, username, token, baseUrl, owner }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const getOfflineFlowContent = (groupId: number, path: string) => {
    const params = new URLSearchParams({
        groupId: String(groupId),
        path,
    });
    return request.get<unknown, OfflineFlowContent>(`/api/v1/offline/flows/content?${params.toString()}`);
};

export const getOfflineFlowDocument = (groupId: number, path: string) => {
    const params = new URLSearchParams({
        groupId: String(groupId),
        path,
    });
    return request.get<unknown, OfflineFlowDocument>(`/api/v1/offline/flows/document?${params.toString()}`);
};

export const saveOfflineFlowContent = (payload: SaveOfflineFlowRequest) => {
    return request.put<unknown, OfflineFlowContent>(buildGroupScopedPath('/api/v1/offline/flows/content', payload.groupId), payload, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const saveOfflineFlowDocument = (payload: SaveOfflineFlowDocumentRequest) => {
    return request.put<unknown, OfflineFlowDocument>(buildGroupScopedPath('/api/v1/offline/flows/document', payload.groupId), payload, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const createOfflineDebugExecution = (payload: DebugExecutionRequest) => {
    return request.post<unknown, OfflineExecutionResponse>(buildGroupScopedPath('/api/v1/offline/executions/debug', payload.groupId), payload, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const createOfflineDocumentDebugExecution = (payload: DebugDocumentExecutionRequest) => {
    return request.post<unknown, OfflineExecutionResponse>(buildGroupScopedPath('/api/v1/offline/executions/debug/document', payload.groupId), payload, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const createOfflineSavedDebugExecution = (payload: SavedDebugExecutionRequest) => {
    return request.post<unknown, OfflineExecutionResponse>(buildGroupScopedPath('/api/v1/offline/executions/debug/current', payload.groupId), payload, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const listOfflineExecutions = (groupId: number, flowPath: string, requestedBy?: number | null) => {
    const params = buildExecutionListSearchParams(groupId, flowPath, requestedBy);
    return request.get<unknown, OfflineExecutionListItem[]>(`/api/v1/offline/executions?${params.toString()}`);
};

export const getOfflineExecution = (groupId: number, executionId: string) => {
    return request.get<unknown, OfflineExecutionDetail>(
        `/api/v1/offline/executions/${encodeURIComponent(executionId)}?groupId=${groupId}`
    );
};

export const getOfflineExecutionLogs = (groupId: number, executionId: string, taskId?: string | null) => {
    const params = new URLSearchParams({ groupId: String(groupId) });
    if (taskId) params.set('taskId', taskId);
    return request.get<unknown, OfflineExecutionLogEntry[]>(
        `/api/v1/offline/executions/${encodeURIComponent(executionId)}/logs?${params.toString()}`
    );
};

export const getOfflineExecutionScript = (groupId: number, executionId: string) => {
    return request.get<unknown, OfflineExecutionScript>(
        `/api/v1/offline/executions/${encodeURIComponent(executionId)}/script?groupId=${groupId}`
    );
};

export const stopOfflineExecution = (groupId: number, executionId: string) => {
    return request.post<unknown, null>(
        `/api/v1/offline/executions/${encodeURIComponent(executionId)}/stop?groupId=${groupId}`,
        null
    );
};

export const stopAllOfflineExecutions = (groupId: number, flowPath: string) => {
    const params = new URLSearchParams({
        groupId: String(groupId),
        flowPath,
    });
    return request.post<unknown, number>(`/api/v1/offline/executions/stop-all?${params.toString()}`, null);
};

export const getOfflineSchedule = (groupId: number, path: string) => {
    const params = new URLSearchParams({
        groupId: String(groupId),
        path,
    });
    return request.get<unknown, OfflineScheduleResponse>(`/api/v1/offline/schedules?${params.toString()}`);
};

export const updateOfflineSchedule = (payload: UpdateOfflineScheduleRequest) => {
    return request.put<unknown, OfflineScheduleResponse>(buildGroupScopedPath('/api/v1/offline/schedules', payload.groupId), payload, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const updateOfflineScheduleStatus = (payload: UpdateOfflineScheduleStatusRequest) => {
    return request.patch<unknown, OfflineScheduleResponse>(buildGroupScopedPath('/api/v1/offline/schedules/status', payload.groupId), payload, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const deleteOfflineFlow = (groupId: number, path: string) => {
    return request.delete(buildGroupScopedPath('/api/v1/offline/flows', groupId), {
        data: { groupId, path },
        headers: { 'Content-Type': 'application/json' },
    });
};

export const renameOfflineFlow = (groupId: number, path: string, newName: string) => {
    return request.post(buildGroupScopedPath('/api/v1/offline/flows/rename', groupId), { groupId, path, newName }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const deleteOfflineFolder = (groupId: number, path: string) => {
    return request.delete(buildGroupScopedPath('/api/v1/offline/repo/folder', groupId), {
        data: { groupId, path },
        headers: { 'Content-Type': 'application/json' },
    });
};

export const renameOfflineFolder = (groupId: number, path: string, newName: string) => {
    return request.post(buildGroupScopedPath('/api/v1/offline/repo/folder/rename', groupId), { groupId, path, newName }, {
        headers: { 'Content-Type': 'application/json' },
    });
};
