import request from '../utils/request';
import type { PageResult } from './datasource';

export interface GroupDetail {
    id: number;
    name: string;
    description: string;
    memberCount: number;
    createdAt: string;
}

export interface CreateGroupPayload {
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
