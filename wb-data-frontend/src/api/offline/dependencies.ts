import request from '../../utils/request';
import { omitGroupId } from '../groupScoped';
import type { OfflineSchedulePeriod } from './schedules';
import { offlinePath } from './shared';

export type OfflineFailurePolicy = 'CONTINUE' | 'PAUSE';

export type OfflineCrossGroupDependency = 'ALLOW' | 'DENY';

export interface OfflineFlowDependencyRef {
    groupId: number;
    flowId: string;
}

export interface OfflineFlowDependencySettings {
    dependencies: OfflineFlowDependencyRef[];
    failurePolicy: OfflineFailurePolicy;
    crossGroupDependency: OfflineCrossGroupDependency;
}

export interface OfflineDependencyItem {
    groupId: number;
    groupName: string | null;
    flowId: string;
    path: string | null;
    period: OfflineSchedulePeriod | null;
    cron: string | null;
    timezone: string | null;
    enabled: boolean;
    crossGroupDependency: OfflineCrossGroupDependency | null;
}

export interface OfflineDependencyConfig {
    groupId: number;
    path: string;
    dependencies: OfflineDependencyItem[];
    failurePolicy: OfflineFailurePolicy;
    crossGroupDependency: OfflineCrossGroupDependency;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface UpdateOfflineDependenciesRequest {
    groupId: number;
    path: string;
    dependencies: OfflineFlowDependencyRef[];
    failurePolicy: OfflineFailurePolicy;
    crossGroupDependency: OfflineCrossGroupDependency;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface OfflineDependencyCandidate {
    groupId: number;
    groupName: string | null;
    flowId: string;
    path: string;
    hasSchedule: boolean;
    period: OfflineSchedulePeriod | null;
    cron: string | null;
    timezone: string | null;
    enabled: boolean;
    crossGroupDependency: OfflineCrossGroupDependency;
}

export interface OfflineDependentItem {
    groupId: number;
    groupName: string | null;
    flowId: string;
    path: string;
    period?: OfflineSchedulePeriod | null;
    cron?: string | null;
}

export const getOfflineDependencies = (groupId: number, path: string) => {
    const params = new URLSearchParams({ path });
    return request.get<unknown, OfflineDependencyConfig>(`${offlinePath(groupId, '/dependencies')}?${params.toString()}`);
};

export const updateOfflineDependencies = (payload: UpdateOfflineDependenciesRequest) => {
    return request.put<unknown, OfflineDependencyConfig>(offlinePath(payload.groupId, '/dependencies'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const searchOfflineDependencyCandidates = (groupId: number, path: string, keyword?: string) => {
    const params = new URLSearchParams({ path });
    if (keyword && keyword.trim()) {
        params.set('keyword', keyword.trim());
    }
    return request.get<unknown, OfflineDependencyCandidate[]>(
        `${offlinePath(groupId, '/dependencies/candidates')}?${params.toString()}`
    );
};

export const getOfflineDependents = (groupId: number, path: string) => {
    const params = new URLSearchParams({ path });
    return request.get<unknown, OfflineDependentItem[]>(`${offlinePath(groupId, '/dependencies/dependents')}?${params.toString()}`);
};
