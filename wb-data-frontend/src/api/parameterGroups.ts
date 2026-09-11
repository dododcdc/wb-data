import request from '../utils/request';
import { groupScopedPath } from './groupScoped';
import type { PageResult } from './datasource';

export type ParameterGroupStatus = 'ACTIVE' | 'ARCHIVED';
export type ParameterValueSource = 'CONSTANT' | 'SYSTEM_TIME';
export type ParameterTimeBasis = 'PLANNED_TIME' | 'EXECUTION_START_TIME';

export interface ParameterDefinition {
    id?: number;
    key: string;
    valueSource: ParameterValueSource;
    constantValue: string | null;
    timeBasis: ParameterTimeBasis | null;
    format: string | null;
    offsetDays: number;
    description: string | null;
    sortOrder: number;
}

export interface ParameterGroupSummary {
    id: number;
    code: string;
    name: string;
    description: string | null;
    version: number;
    revision: number;
    status: ParameterGroupStatus;
    parameterCount: number;
    createdBy: number;
    updatedBy: number;
    createdAt: string;
    updatedAt: string;
}

export interface ParameterGroup extends ParameterGroupSummary {
    definitions: ParameterDefinition[];
}

export interface ParameterGroupListQuery {
    groupId: number;
    page?: number;
    size?: number;
    keyword?: string;
    status?: ParameterGroupStatus;
}

export interface CreateParameterGroupRequest {
    code: string;
    name: string;
    description: string | null;
    definitions: ParameterDefinition[];
}

export interface UpdateParameterGroupRequest {
    expectedRevision: number;
    name: string;
    description: string | null;
    definitions: ParameterDefinition[];
}

export interface ParameterPreviewRequest {
    executionStartTime: string | null;
    plannedTime: string | null;
    runtimeTimezone: string;
    overrides: Record<string, string>;
}

export interface ParameterPreviewValue {
    key: string;
    valueSource: ParameterValueSource;
    timeBasis: ParameterTimeBasis | null;
    value: string;
    overridden: boolean;
}

export interface ParameterPreview {
    parameterGroupId: number;
    version: number;
    runtimeTimezone: string;
    plannedTime: string | null;
    executionStartTime: string | null;
    values: ParameterPreviewValue[];
}

const parameterGroupPath = (groupId: number, suffix = '') =>
    groupScopedPath(groupId, `/parameter-groups${suffix}`);

export const getParameterGroupPage = ({ groupId, ...params }: ParameterGroupListQuery) =>
    request.get<unknown, PageResult<ParameterGroupSummary>>(parameterGroupPath(groupId), { params });

export const getParameterGroup = (groupId: number, id: number) =>
    request.get<unknown, ParameterGroup>(parameterGroupPath(groupId, `/${id}`));

export const createParameterGroup = (groupId: number, data: CreateParameterGroupRequest) =>
    request.post<unknown, ParameterGroup>(parameterGroupPath(groupId), data);

export const updateParameterGroup = (groupId: number, id: number, data: UpdateParameterGroupRequest) =>
    request.put<unknown, ParameterGroup>(parameterGroupPath(groupId, `/${id}`), data);

export const archiveParameterGroup = (groupId: number, id: number) =>
    request.post<unknown, ParameterGroup>(parameterGroupPath(groupId, `/${id}/archive`));

export const restoreParameterGroup = (groupId: number, id: number) =>
    request.post<unknown, ParameterGroup>(parameterGroupPath(groupId, `/${id}/restore`));

export const previewParameterGroup = (groupId: number, id: number, data: ParameterPreviewRequest) =>
    request.post<unknown, ParameterPreview>(parameterGroupPath(groupId, `/${id}/preview`), data);
