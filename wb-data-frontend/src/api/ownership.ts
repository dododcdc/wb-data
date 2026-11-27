import request from '../utils/request';
import { groupScopedPath } from './groupScoped';

export interface GroupMemberAssetSummary {
    groupId: number;
    groupName: string;
    userId: number;
    dataSourceCount: number;
    parameterGroupCount: number;
    offlineFlowCount: number;
    totalCount: number;
}

export interface UserAssetSummary {
    userId: number;
    totalDataSources: number;
    totalParameterGroups: number;
    totalOfflineFlows: number;
    totalCount: number;
    groups: GroupMemberAssetSummary[];
}

export interface GroupAssetHandoverResult {
    groupId: number;
    fromUserId: number;
    targetOwnerUserId: number;
    targetOwnerName: string;
    dataSourcesTransferred: number;
    parameterGroupsTransferred: number;
    offlineFlowsTransferred: number;
    totalTransferred: number;
}

export interface UserAssetHandoverTarget {
    groupId: number;
    targetOwnerUserId: number;
}

export interface UserAssetHandoverResult {
    fromUserId: number;
    totalTransferred: number;
    results: GroupAssetHandoverResult[];
}

export const getGroupMemberAssetSummary = (groupId: number, userId: number) => {
    return request.get<unknown, GroupMemberAssetSummary>(
        groupScopedPath(groupId, `/settings/members/${userId}/assets`),
    );
};

export const handoverGroupMemberAssets = (
    groupId: number,
    userId: number,
    targetOwnerUserId: number,
) => {
    return request.post<unknown, GroupAssetHandoverResult>(
        groupScopedPath(groupId, `/settings/members/${userId}/handover`),
        { targetOwnerUserId },
    );
};

export const getUserAssetSummary = (userId: number) => {
    return request.get<unknown, UserAssetSummary>(`/users/${userId}/assets`);
};

export const handoverUserAssets = (
    userId: number,
    transfers: UserAssetHandoverTarget[],
) => {
    return request.post<unknown, UserAssetHandoverResult>(
        `/users/${userId}/handover`,
        { transfers },
    );
};
