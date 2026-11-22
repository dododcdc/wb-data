import request from '../../utils/request';
import { omitGroupId } from '../groupScoped';
import { offlinePath } from './shared';

export type OfflineSchedulePeriod = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';

export interface OfflineFlowSchedule {
    cron: string;
    timezone: string;
    enabled: boolean;
    period: OfflineSchedulePeriod;
}

export interface OfflineScheduleResponse {
    groupId: number;
    path: string;
    triggerId: string;
    cron: string;
    timezone: string | null;
    enabled: boolean;
    period: OfflineSchedulePeriod;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface UpdateOfflineScheduleRequest {
    groupId: number;
    path: string;
    cron: string;
    period: OfflineSchedulePeriod;
    contentHash: string;
    fileUpdatedAt: number;
}

export interface UpdateOfflineScheduleStatusRequest {
    groupId: number;
    path: string;
    enabled: boolean;
    contentHash: string;
    fileUpdatedAt: number;
}

export const getOfflineSchedule = (groupId: number, path: string) => {
    const params = new URLSearchParams({
        path,
    });
    return request.get<unknown, OfflineScheduleResponse>(`${offlinePath(groupId, '/schedules')}?${params.toString()}`);
};

export const updateOfflineSchedule = (payload: UpdateOfflineScheduleRequest) => {
    return request.put<unknown, OfflineScheduleResponse>(offlinePath(payload.groupId, '/schedules'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const updateOfflineScheduleStatus = (payload: UpdateOfflineScheduleStatusRequest) => {
    return request.patch<unknown, OfflineScheduleResponse>(offlinePath(payload.groupId, '/schedules/status'), omitGroupId(payload), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};
