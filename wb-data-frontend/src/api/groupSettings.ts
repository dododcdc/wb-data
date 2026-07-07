import request from '../utils/request';
import { groupScopedPath } from './groupScoped';
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

export interface AddMembersPayload {
    userIds: number[];
    role: string;
}

export interface UpdateMemberRolePayload {
    role: string;
}

export const getGroupSettings = (groupId: number) => {
    return request.get<unknown, GroupSettingsInfo>(groupScopedPath(groupId, '/settings'));
};

export const updateGroupSettings = (groupId: number, data: UpdateGroupSettingsPayload) => {
    return request.put<unknown, GroupSettingsInfo>(groupScopedPath(groupId, '/settings'), data);
};

export const getMemberPage = (params: { groupId: number; page?: number; size?: number; keyword?: string }) => {
    const { groupId, ...rest } = params;
    return request.get<unknown, PageResult<MemberRecord>>(groupScopedPath(groupId, '/settings/members'), { params: rest });
};

export const getAvailableUsers = (groupId: number, keyword?: string, page: number = 1, size: number = 50) => {
    return request.get<unknown, PageResult<AvailableUser>>(groupScopedPath(groupId, '/settings/available-users'), { params: { keyword, page, size } });
};

export const addMember = (groupId: number, data: AddMemberPayload) => {
    return request.post<unknown, MemberRecord>(groupScopedPath(groupId, '/settings/members'), data);
};

export const addMembers = (groupId: number, data: AddMembersPayload) => {
    return request.post<unknown, void>(groupScopedPath(groupId, '/settings/members/batch'), data);
};

export const updateMemberRole = (groupId: number, memberId: number, data: UpdateMemberRolePayload) => {
    return request.put<unknown, void>(groupScopedPath(groupId, `/settings/members/${memberId}/role`), data);
};

export const removeMember = (groupId: number, memberId: number) => {
    return request.delete<unknown, void>(groupScopedPath(groupId, `/settings/members/${memberId}`));
};
