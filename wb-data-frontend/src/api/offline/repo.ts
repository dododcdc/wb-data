import request from '../../utils/request';
import { groupScopedPath } from '../groupScoped';
import { offlinePath, REMOTE_GIT_REQUEST_TIMEOUT_MS } from './shared';

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
    ahead?: boolean;
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
    recentFlowPaths?: string[];
}

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
        timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const pushOfflineCurrentFlow = (groupId: number, flowPath: string) => {
    return request.post<unknown, PushResult>(
        offlinePath(groupId, '/repo/push/flow'),
        { flowPath },
        {
            timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
        }
    );
};

export const rebuildOfflineRepo = (groupId: number) => {
    return request.post<unknown, PushResult>(offlinePath(groupId, '/repo/push/rebuild'), {}, {
        timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const createOfflineFolder = (groupId: number, path: string) => {
    return request.post<unknown, null>(offlinePath(groupId, '/repo/folder'), { path }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const deleteOfflineFolder = (groupId: number, path: string) => {
    return request.delete(offlinePath(groupId, '/repo/folder'), {
        data: { path },
        headers: { 'Content-Type': 'application/json' },
    });
};

export const moveOfflineFolder = (groupId: number, path: string, newPath: string) => {
    return request.post(offlinePath(groupId, '/repo/folder/move'), { path, newPath }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const testGitHubConnection = (groupId: number, provider: string, username: string, token: string, baseUrl: string, owner: string) => {
    return request.post<unknown, string>(groupScopedPath(groupId, '/git/config/test'), { provider, username, token, baseUrl, owner }, {
        timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const listBranches = (groupId: number) => {
    return request.get<unknown, BranchListResponse>(offlinePath(groupId, '/repo/branches'), {
        timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
    });
};

export const createBranch = (groupId: number, name: string, baseBranch: string) => {
    return request.post<unknown, null>(offlinePath(groupId, '/repo/branch'), { name, baseBranch }, {
        timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const switchBranch = (groupId: number, branch: string) => {
    return request.put<unknown, null>(offlinePath(groupId, '/repo/branch/switch'), { branch }, {
        timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const mergeBranch = (groupId: number, source: string, target: string) => {
    return request.post<unknown, null>(offlinePath(groupId, '/repo/branch/merge'), { source, target }, {
        timeout: REMOTE_GIT_REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const deleteBranch = (groupId: number, name: string, force: boolean = false) => {
    return request.delete(offlinePath(groupId, '/repo/branch'), {
        data: { name, force },
        headers: { 'Content-Type': 'application/json' },
    });
};
