import request from '../../utils/request';
import { groupScopedPath } from '../../api/groupScoped';

export interface GitConfig {
    id: number;
    provider: string;
    username: string;
    tokenMasked: string;
    baseUrl: string;
}

export interface SaveGitConfigPayload {
    provider: string;
    username: string;
    token: string;
    baseUrl: string;
}

export interface GitSyncConfig {
    id: number;
    groupId: number;
    branch: string;
    namespace: string;
    syncFlowId: string;
    enabled: boolean;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    lastSyncMessage: string | null;
}

export interface GitSyncConfigList {
    configs: GitSyncConfig[];
    availableBranches: string[];
    syncCron: string;
}

export interface AddAllGitSyncConfigsResponse {
    created: number;
    existing: number;
    configs: GitSyncConfig[];
}

export interface TriggerGitSyncResponse {
    id: number;
    executionId: string;
    status: string;
    triggeredAt: string | null;
}

export const getGitConfig = (groupId: number) => {
    return request.get<unknown, GitConfig | null>(groupScopedPath(groupId, '/git/config'));
};

export const saveGitConfig = (groupId: number, payload: SaveGitConfigPayload) => {
    return request.post(groupScopedPath(groupId, '/git/config'), payload, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const deleteGitConfig = (groupId: number) => {
    return request.delete<unknown, void>(groupScopedPath(groupId, '/git/config'));
};

export const testGitConnection = (groupId: number, payload: SaveGitConfigPayload) => {
    return request.post<unknown, string>(groupScopedPath(groupId, '/git/config/test'), payload, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const getGitSyncConfigs = (groupId: number) => {
    return request.get<unknown, GitSyncConfigList>(groupScopedPath(groupId, '/git/sync-config'));
};

export const createGitSyncConfig = (groupId: number, branch: string) => {
    return request.post<unknown, GitSyncConfig>(groupScopedPath(groupId, '/git/sync-config'), { branch }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const createAllGitSyncConfigs = (groupId: number) => {
    return request.post<unknown, AddAllGitSyncConfigsResponse>(groupScopedPath(groupId, '/git/sync-config/all-known-branches'));
};

export const updateGitSyncConfigStatus = (groupId: number, id: number, enabled: boolean) => {
    return request.patch<unknown, GitSyncConfig>(groupScopedPath(groupId, `/git/sync-config/${id}/status`), { enabled }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const triggerGitSyncConfig = (groupId: number, id: number) => {
    return request.post<unknown, TriggerGitSyncResponse>(groupScopedPath(groupId, `/git/sync-config/${id}/trigger`));
};

export const deleteGitSyncConfig = (groupId: number, id: number) => {
    return request.delete<unknown, void>(groupScopedPath(groupId, `/git/sync-config/${id}`));
};
