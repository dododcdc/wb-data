import request from '../utils/request';
import { groupScopedPath, omitGroupId } from './groupScoped';
import { buildExecutionListSearchParams } from '../views/offline/executionFilters';
import type { TransferConfig } from '../views/offline/transfer/transferTypes';

function offlinePath(groupId: number, path: string) {
    return groupScopedPath(groupId, `/offline${path}`);
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
    remoteDeleted: boolean;
}

export interface CommitResult {
    success: boolean;
    message: string;
}

export interface OfflineFlowCommitStatus {
    groupId: number;
    flowPath: string;
    dirty: boolean;
}

export interface OfflineRepoStatus {
    groupId: number;
    repoPath: string;
    exists: boolean;
    gitInitialized: boolean;
    dirty: boolean;
    ahead: boolean;
    hasRemote: boolean;
    hasUpstream: boolean;
    branch: string | null;
    headCommitId: string | null;
    headCommitMessage: string | null;
    headCommitAt: string | null;
}

export type OfflineScheduleState = 'NONE' | 'DISABLED' | 'ENABLED';

export interface OfflineRepoTreeNode {
    id: string;
    kind: 'ROOT' | 'DIRECTORY' | 'FLOW';
    name: string;
    path: string;
    children: OfflineRepoTreeNode[];
    scheduleState: OfflineScheduleState;
    schedulePeriod: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM' | null;
    dependencyCount: number;
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

export type OfflineSchedulePeriod = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';

export interface OfflineFlowSchedule {
    cron: string;
    timezone: string;
    enabled: boolean;
    period: OfflineSchedulePeriod;
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
    schedule?: OfflineFlowSchedule;
    dependencyConfig?: OfflineFlowDependencySettings;
    parameterBinding?: FlowParameterBindingRequest | null;
    parameterBindings?: FlowParameterBindingRequest[] | null;
    runtimeTimezone: string;
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

export interface OfflineScheduleResponse {
    groupId: number;
    path: string;
    triggerId: string;
    cron: string;
    timezone: string | null;
    enabled: boolean;
    period: OfflineSchedulePeriod;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface UpdateOfflineScheduleRequest {
    groupId: number;
    path: string;
    cron: string;
    period: OfflineSchedulePeriod;
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

export type OfflineFailurePolicy = 'CONTINUE' | 'PAUSE';

export type OfflineCrossGroupDependency = 'ALLOW' | 'DENY';

export interface OfflineFlowDependencyRef {
    groupId: number;
    flowId: string;
}

export interface OfflineFlowDependencySettings {
    dependencies: OfflineFlowDependencyRef[];
    failurePolicy: OfflineFailurePolicy;
    crossGroupDependency: OfflineCrossGroupDependency;
}

export interface OfflineDependencyItem {
    groupId: number;
    groupName: string | null;
    flowId: string;
    path: string | null;
    period: OfflineSchedulePeriod | null;
    cron: string | null;
    timezone: string | null;
    enabled: boolean;
    crossGroupDependency: OfflineCrossGroupDependency | null;
}

export interface OfflineDependencyConfig {
    groupId: number;
    path: string;
    dependencies: OfflineDependencyItem[];
    failurePolicy: OfflineFailurePolicy;
    crossGroupDependency: OfflineCrossGroupDependency;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface UpdateOfflineDependenciesRequest {
    groupId: number;
    path: string;
    dependencies: OfflineFlowDependencyRef[];
    failurePolicy: OfflineFailurePolicy;
    crossGroupDependency: OfflineCrossGroupDependency;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface OfflineDependencyCandidate {
    groupId: number;
    groupName: string | null;
    flowId: string;
    path: string;
    hasSchedule: boolean;
    period: OfflineSchedulePeriod | null;
    cron: string | null;
    timezone: string | null;
    enabled: boolean;
    crossGroupDependency: OfflineCrossGroupDependency;
}

export interface OfflineDependentItem {
    groupId: number;
    groupName: string | null;
    flowId: string;
    path: string;
}

export const getOfflineRepoStatus = (groupId: number) => {
    return request.get<unknown, OfflineRepoStatus>(offlinePath(groupId, '/repo/status'));
};

export const getOfflineRepoTree = (groupId: number) => {
    return request.get<unknown, OfflineRepoTreeResponse>(offlinePath(groupId, '/repo/tree'));
};

export const getOfflineRepoRemote = (groupId: number) => {
    return request.get<unknown, RemoteStatus>(offlinePath(groupId, '/repo/remote'));
};

export const commitOfflineCurrentFlow = (groupId: number, flowPath: string, message: string) => {
    return request.post<unknown, CommitResult>(
        offlinePath(groupId, '/repo/commit/flow'),
        { flowPath, message },
        { headers: { 'Content-Type': 'application/json' } }
    );
};

export const getOfflineFlowCommitStatus = (groupId: number, flowPath: string) => {
    return request.get<unknown, OfflineFlowCommitStatus>(
        `${offlinePath(groupId, '/repo/commit/flow/status')}?path=${encodeURIComponent(flowPath)}`
    );
};

export const commitOfflineRepo = (groupId: number, message: string) => {
    return request.post<unknown, CommitResult>(offlinePath(groupId, '/repo/commit'), { message }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const pushOfflineRepo = (groupId: number) => {
    return request.post<unknown, PushResult>(offlinePath(groupId, '/repo/push'), {}, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const rebuildOfflineRepo = (groupId: number) => {
    return request.post<unknown, PushResult>(offlinePath(groupId, '/repo/push/rebuild'), {}, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const createOfflineFolder = (groupId: number, path: string) => {
    return request.post<unknown, null>(offlinePath(groupId, '/repo/folder'), { path }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const testGitHubConnection = (groupId: number, provider: string, username: string, token: string, baseUrl: string, owner: string) => {
    return request.post<unknown, string>(groupScopedPath(groupId, '/git/config/test'), { provider, username, token, baseUrl, owner }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

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

export const getOfflineSchedule = (groupId: number, path: string) => {
    const params = new URLSearchParams({
        path,
    });
    return request.get<unknown, OfflineScheduleResponse>(`${offlinePath(groupId, '/schedules')}?${params.toString()}`);
};

export const updateOfflineSchedule = (payload: UpdateOfflineScheduleRequest) => {
    return request.put<unknown, OfflineScheduleResponse>(offlinePath(payload.groupId, '/schedules'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const updateOfflineScheduleStatus = (payload: UpdateOfflineScheduleStatusRequest) => {
    return request.patch<unknown, OfflineScheduleResponse>(offlinePath(payload.groupId, '/schedules/status'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const getOfflineDependencies = (groupId: number, path: string) => {
    const params = new URLSearchParams({ path });
    return request.get<unknown, OfflineDependencyConfig>(`${offlinePath(groupId, '/dependencies')}?${params.toString()}`);
};

export const updateOfflineDependencies = (payload: UpdateOfflineDependenciesRequest) => {
    return request.put<unknown, OfflineDependencyConfig>(offlinePath(payload.groupId, '/dependencies'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const searchOfflineDependencyCandidates = (groupId: number, path: string, keyword?: string) => {
    const params = new URLSearchParams({ path });
    if (keyword && keyword.trim()) {
        params.set('keyword', keyword.trim());
    }
    return request.get<unknown, OfflineDependencyCandidate[]>(
        `${offlinePath(groupId, '/dependencies/candidates')}?${params.toString()}`
    );
};

export const getOfflineDependents = (groupId: number, path: string) => {
    const params = new URLSearchParams({ path });
    return request.get<unknown, OfflineDependentItem[]>(`${offlinePath(groupId, '/dependencies/dependents')}?${params.toString()}`);
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

export const deleteOfflineFolder = (groupId: number, path: string) => {
    return request.delete(offlinePath(groupId, '/repo/folder'), {
        data: { path },
        headers: { 'Content-Type': 'application/json' },
    });
};

// --- Branch management ---

export interface BranchItem {
    name: string;
    current: boolean;
    local: boolean;
    remote: boolean;
    remoteName: string | null;
    trackingBranch: string | null;
}

export interface BranchListResponse {
    branches: BranchItem[];
}

export interface DirtyWorkingTreeResponse {
    changedFlows: string[];
    changedFiles: string[];
    otherFileCount: number;
    changedFlowDetails?: DirtyFlowChange[];
}

export interface DirtyFlowChange {
    path: string;
    status: 'ADDED' | 'MODIFIED' | 'DELETED';
}

export const listBranches = (groupId: number) => {
    return request.get<unknown, BranchListResponse>(offlinePath(groupId, '/repo/branches'));
};

export const createBranch = (groupId: number, name: string, baseBranch: string) => {
    return request.post<unknown, null>(offlinePath(groupId, '/repo/branch'), { name, baseBranch }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const switchBranch = (groupId: number, branch: string) => {
    return request.put<unknown, null>(offlinePath(groupId, '/repo/branch/switch'), { branch }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const mergeBranch = (groupId: number, source: string, target: string) => {
    return request.post<unknown, null>(offlinePath(groupId, '/repo/branch/merge'), { source, target }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const deleteBranch = (groupId: number, name: string, force: boolean = false) => {
    return request.delete(offlinePath(groupId, '/repo/branch'), {
        data: { name, force },
        headers: { 'Content-Type': 'application/json' },
    });
};

export const moveOfflineFolder = (groupId: number, path: string, newPath: string) => {
    return request.post(offlinePath(groupId, '/repo/folder/move'), { path, newPath }, {
        headers: { 'Content-Type': 'application/json' },
    });
};
