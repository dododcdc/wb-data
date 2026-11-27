import request from '../utils/request';
import { groupScopedPath } from './groupScoped';
import type { AssetOwnerSummary, OwnerStatus, TransferOwnerPayload, TransferOwnerResult } from './groupSettings';

export interface DataSource {
    id: number;
    name: string;
    type: string;
    description: string;
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    connectionParams: Record<string, unknown>;
    status: string;
    owner: string;
    ownerUserId?: number | null;
    ownerName?: string | null;
    ownerUsername?: string | null;
    ownerStatus?: OwnerStatus | null;
    createdAt: string;
    updatedAt: string;
}

export interface DataSourceSavePayload {
    name: string;
    type: string;
    description?: string;
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    password?: string;
    connectionParams?: Record<string, unknown>;
    owner?: string;
    ownerUserId?: number | null;
}

export interface PluginFieldDescriptor {
    key: string;
    section: string;
    label: string;
    placeholder: string;
    inputType: string;
    required: boolean;
    defaultValue?: string | null;
}

export interface DataSourcePluginDescriptor {
    type: string;
    label: string;
    order: number;
    helperText: string;
    supportsConnectionTest: boolean;
    fields: PluginFieldDescriptor[];
}

export interface DataSourceSearchQuery {
    page?: number;
    size?: number;
    keyword?: string;
    type?: string;
    typeList?: string[];
    status?: string;
    ownerUserId?: number;
    groupId?: number;
}

export interface PageResult<T> {
    records: T[];
    total: number;
    size: number;
    current: number;
    pages: number;
}

export interface ConnectionTestResult {
    success: boolean;
    message: string;
}

export const getDataSourcePage = (params: DataSourceSearchQuery) => {
    const { groupId, ...rest } = params;
    if (groupId == null) {
        return request.get<unknown, PageResult<DataSource>>('/api/v1/datasources', { params: rest });
    }
    return request.get<unknown, PageResult<DataSource>>(groupScopedPath(groupId, '/datasources'), { params: rest });
};

export const getDataSourcePlugins = () => {
    return request.get<unknown, DataSourcePluginDescriptor[]>('/api/v1/datasources/plugins');
};

export const getDataSourceById = (id: number, groupId?: number | null) => {
    const path = groupId == null ? `/api/v1/datasources/${id}` : groupScopedPath(groupId, `/datasources/${id}`);
    return request.get<unknown, DataSource>(path);
};

export const createDataSource = (data: DataSourceSavePayload, groupId: number) => {
    return request.post<unknown, boolean>(groupScopedPath(groupId, '/datasources'), data);
};

export const updateDataSource = (id: number, data: DataSourceSavePayload, groupId: number) => {
    return request.put<unknown, boolean>(groupScopedPath(groupId, `/datasources/${id}`), data);
};

export const deleteDataSource = (id: number, groupId: number) => {
    return request.delete<unknown, boolean>(groupScopedPath(groupId, `/datasources/${id}`));
};

export const updateDataSourceStatus = (id: number, status: string, groupId: number) => {
    return request.patch<unknown, void>(groupScopedPath(groupId, `/datasources/${id}/status`), { status });
};

export interface DataSourceConnectionPayload {
    type: string;
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    password?: string;
    connectionParams?: Record<string, unknown>;
}

export const testNewConnection = (data: DataSourceConnectionPayload, groupId: number) => {
    return request.post<unknown, ConnectionTestResult>(groupScopedPath(groupId, '/datasources/test-connection'), data);
};

export const testExistingConnection = (id: number, groupId: number) => {
    return request.post<unknown, ConnectionTestResult>(groupScopedPath(groupId, `/datasources/${id}/test`));
};

export const getDataSourceOwners = (groupId: number) => {
    return request.get<unknown, AssetOwnerSummary[]>(groupScopedPath(groupId, '/datasources/owners'));
};

export const transferDataSourceOwner = (groupId: number, payload: TransferOwnerPayload) => {
    return request.post<unknown, TransferOwnerResult>(groupScopedPath(groupId, '/datasources/transfer-owner'), payload);
};
