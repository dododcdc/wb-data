import request from '../utils/request';
import type { PageResult } from './datasource';

export interface UserRecord {
    id: number;
    username: string;
    displayName: string;
    systemRole: string;
    status: string;
    lastLoginAt: string | null;
    createdAt: string;
}

export interface GroupSimple {
    id: number;
    name: string;
    description: string;
}

export interface GroupAssignment {
    groupId: number;
    groupRole: string;
}

export interface UserGroupInfo {
    groupId: number;
    groupName: string;
    groupRole: string;
}

export interface CreateUserPayload {
    username: string;
    displayName: string;
    password: string;
    systemRole: string;
    groupAssignments?: GroupAssignment[];
}

export interface UpdateUserPayload {
    displayName: string;
    systemRole: string;
    groupAssignments?: GroupAssignment[];
}

export interface ResetPasswordPayload {
    newPassword: string;
}

export interface UpdateUserStatusPayload {
    status: string;
}

export const getUserPage = (params: { page?: number; size?: number; keyword?: string }) => {
    return request.get<unknown, PageResult<UserRecord>>('/api/v1/users', { params });
};

export const createUser = (data: CreateUserPayload) => {
    return request.post<unknown, UserRecord>('/api/v1/users', data);
};

export const updateUser = (id: number, data: UpdateUserPayload) => {
    return request.put<unknown, UserRecord>(`/api/v1/users/${id}`, data);
};

export const changeUserStatus = (id: number, data: UpdateUserStatusPayload) => {
    return request.patch<unknown, void>(`/api/v1/users/${id}/status`, data);
};

export const resetUserPassword = (id: number, data: ResetPasswordPayload) => {
    return request.post<unknown, void>(`/api/v1/users/${id}/reset-password`, data);
};

export const getAllGroups = () => {
    return request.get<unknown, GroupSimple[]>('/api/v1/groups');
};

export const getUserGroups = (id: number) => {
    return request.get<unknown, UserGroupInfo[]>(`/api/v1/users/${id}/groups`);
};
