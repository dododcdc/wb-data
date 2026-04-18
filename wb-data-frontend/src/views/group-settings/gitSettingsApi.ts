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

export const testGitConnection = (payload: SaveGitConfigPayload) => {
    return request.post<unknown, string>('/api/v1/git/config/test', payload, {
        headers: { 'Content-Type': 'application/json' },
    });
};
