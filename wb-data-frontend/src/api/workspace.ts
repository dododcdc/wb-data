import request from '../utils/request';
import { groupScopedPath } from './groupScoped';
import type { OperationsExecutionListItem, OperationsExecutionStatusCounts } from './operations';

export interface WorkspaceDataSourceTypeCount {
    type: string;
    count: number;
}

export interface WorkspaceDataSourceBrief {
    id: number;
    name: string;
    type: string;
    description: string | null;
    databaseName: string | null;
    status: string;
}

export interface WorkspaceDataSourceSummary {
    total: number;
    enabledCount: number;
    byType: WorkspaceDataSourceTypeCount[];
    items: WorkspaceDataSourceBrief[];
}

export interface WorkspaceRecentFlowItem {
    path: string;
    name: string;
    directory: string;
    scheduleState: 'NONE' | 'DISABLED' | 'ENABLED' | string;
    schedulePeriod: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM' | string | null;
    dirty: boolean;
}

export interface WorkspaceOfflineSummary {
    repoInitialized: boolean;
    branch: string | null;
    workingTreeBranch: string | null;
    availableBranches: string[];
    dirty: boolean;
    ahead: boolean;
    hasRemote: boolean;
    hasUpstream: boolean;
    headCommitId: string | null;
    headCommitMessage: string | null;
    headCommitAt: string | null;
    flowCount: number;
    scheduledFlowCount: number;
    dirtyFlowCount: number;
    recentFlows: WorkspaceRecentFlowItem[];
}

export interface WorkspaceOperationsSummary {
    available: boolean;
    errorMessage: string | null;
    selectedBranch: string | null;
    branchSynced: boolean;
    availableBranches: string[];
    counts: OperationsExecutionStatusCounts;
    attentionExecutions: OperationsExecutionListItem[];
    recentExecutions: OperationsExecutionListItem[];
}

export interface WorkspaceParameterSummary {
    activeCount: number;
}

export interface WorkspaceGitSyncSummary {
    configured: boolean;
    enabledCount: number;
    latestBranch: string | null;
    latestStatus: string | null;
    latestSyncAt: string | null;
    latestMessage: string | null;
}

export interface WorkspaceMemberSummary {
    totalCount: number;
}

export interface WorkspaceSummaryResponse {
    groupId: number;
    groupName: string;
    role: string | null;
    onboarding: boolean;
    datasources: WorkspaceDataSourceSummary | null;
    offline: WorkspaceOfflineSummary | null;
    operations: WorkspaceOperationsSummary | null;
    parameters: WorkspaceParameterSummary | null;
    gitSync: WorkspaceGitSyncSummary | null;
    members: WorkspaceMemberSummary | null;
}

export const getWorkspaceSummary = (groupId: number, branch?: string) => {
    return request.get<unknown, WorkspaceSummaryResponse>(
        groupScopedPath(groupId, '/workspace/summary'),
        branch ? { params: { branch } } : undefined,
    );
};
