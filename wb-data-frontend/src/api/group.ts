import request from '../utils/request';
import type { PageResult } from './datasource';

export interface GroupDetail {
    id: number;
    name: string;
    description: string;
    status: 'active' | 'disabled';
    memberCount: number;
    createdAt: string;
}

export interface GitConfigSetup {
    provider: string;
    username: string;
    token: string;
    baseUrl: string;
}

export interface CreateGroupPayload {
    name: string;
    description?: string;
    gitConfig?: GitConfigSetup;
}

export interface UpdateGroupPayload {
    name: string;
    description?: string;
}

export const getGroupPage = (params: { page?: number; size?: number; keyword?: string }) => {
    return request.get<unknown, PageResult<GroupDetail>>('/api/v1/groups', { params });
};

export const createGroup = (data: CreateGroupPayload) => {
    return request.post<unknown, GroupDetail>('/api/v1/groups', data);
};

export const deleteGroup = (id: number) => {
    return request.delete<unknown, void>(`/api/v1/groups/${id}`);
};

export const updateGroup = (id: number, data: UpdateGroupPayload) => {
    return request.put<unknown, GroupDetail>(`/api/v1/groups/${id}`, data);
};

export const disableGroup = (id: number) => {
    return request.patch<unknown, GroupDetail>(`/api/v1/groups/${id}/disable`);
};

export const enableGroup = (id: number) => {
    return request.patch<unknown, GroupDetail>(`/api/v1/groups/${id}/enable`);
};
