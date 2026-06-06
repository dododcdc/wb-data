import request from '../../utils/request';

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
    return request.get<unknown, GitConfig | null>(`/api/v1/git/config?groupId=${groupId}`);
};

export const saveGitConfig = (groupId: number, payload: SaveGitConfigPayload) => {
    return request.post(`/api/v1/git/config?groupId=${groupId}`, payload, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const deleteGitConfig = (groupId: number) => {
    return request.delete<unknown, void>(`/api/v1/git/config?groupId=${groupId}`);
};

export const testGitConnection = (groupId: number, payload: SaveGitConfigPayload) => {
    return request.post<unknown, string>(`/api/v1/git/config/test?groupId=${groupId}`, payload, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const getGitSyncConfigs = (groupId: number) => {
    return request.get<unknown, GitSyncConfigList>(`/api/v1/git/sync-config?groupId=${groupId}`);
};

export const createGitSyncConfig = (groupId: number, branch: string) => {
    return request.post<unknown, GitSyncConfig>(`/api/v1/git/sync-config?groupId=${groupId}`, { branch }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const createAllGitSyncConfigs = (groupId: number) => {
    return request.post<unknown, AddAllGitSyncConfigsResponse>(`/api/v1/git/sync-config/all-known-branches?groupId=${groupId}`);
};

export const updateGitSyncConfigStatus = (groupId: number, id: number, enabled: boolean) => {
    return request.patch<unknown, GitSyncConfig>(`/api/v1/git/sync-config/${id}/status?groupId=${groupId}`, { enabled }, {
        headers: { 'Content-Type': 'application/json' },
    });
};

export const triggerGitSyncConfig = (groupId: number, id: number) => {
    return request.post<unknown, TriggerGitSyncResponse>(`/api/v1/git/sync-config/${id}/trigger?groupId=${groupId}`);
};

export const deleteGitSyncConfig = (groupId: number, id: number) => {
    return request.delete<unknown, void>(`/api/v1/git/sync-config/${id}?groupId=${groupId}`);
};
