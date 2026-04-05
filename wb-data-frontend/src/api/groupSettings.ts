import request from '../utils/request';
import type { PageResult } from './datasource';

export interface GroupSettingsInfo {
    id: number;
    name: string;
    description: string;
    createdAt: string;
}

export interface UpdateGroupSettingsPayload {
    name: string;
    description?: string;
}

export interface MemberRecord {
    id: number;
    userId: number;
    username: string;
    displayName: string;
    role: string;
    createdAt: string;
}

export interface AvailableUser {
    id: number;
    username: string;
    displayName: string;
}

export interface AddMemberPayload {
    userId: number;
    role: string;
}

export interface UpdateMemberRolePayload {
    role: string;
}

export const getGroupSettings = (groupId: number) => {
    return request.get<unknown, GroupSettingsInfo>('/api/v1/group-settings', { params: { groupId } });
};

export const updateGroupSettings = (groupId: number, data: UpdateGroupSettingsPayload) => {
    return request.put<unknown, GroupSettingsInfo>('/api/v1/group-settings', data, { params: { groupId } });
};

export const getMemberPage = (params: { groupId: number; page?: number; size?: number; keyword?: string }) => {
    return request.get<unknown, PageResult<MemberRecord>>('/api/v1/group-settings/members', { params });
};

export const getAvailableUsers = (groupId: number, keyword?: string) => {
    return request.get<unknown, AvailableUser[]>('/api/v1/group-settings/available-users', { params: { groupId, keyword } });
};

export const addMember = (groupId: number, data: AddMemberPayload) => {
    return request.post<unknown, MemberRecord>('/api/v1/group-settings/members', data, { params: { groupId } });
};

export const updateMemberRole = (groupId: number, memberId: number, data: UpdateMemberRolePayload) => {
    return request.put<unknown, void>(`/api/v1/group-settings/members/${memberId}/role`, data, { params: { groupId } });
};

export const removeMember = (groupId: number, memberId: number) => {
    return request.delete<unknown, void>(`/api/v1/group-settings/members/${memberId}`, { params: { groupId } });
};
