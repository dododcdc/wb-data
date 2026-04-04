import request from '../utils/request';

export interface DataSource {
    id: number;
    name: string;
    type: string;
    description: string;
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    password?: string;
    connectionParams: Record<string, unknown>;
    status: string;
    owner: string;
    createdAt: string;
    updatedAt: string;
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
    return request.get<unknown, PageResult<DataSource>>('/api/v1/datasources', { params });
};

export const getDataSourcePlugins = () => {
    return request.get<unknown, DataSourcePluginDescriptor[]>('/api/v1/datasources/plugins');
};

export const getDataSourceById = (id: number) => {
    return request.get<unknown, DataSource>(`/api/v1/datasources/${id}`);
};

export const createDataSource = (data: Partial<DataSource>, groupId: number) => {
    return request.post<unknown, boolean>('/api/v1/datasources', data, { params: { groupId } });
};

export const updateDataSource = (id: number, data: Partial<DataSource>) => {
    return request.put<unknown, boolean>(`/api/v1/datasources/${id}`, data);
};

export const deleteDataSource = (id: number) => {
    return request.delete<unknown, boolean>(`/api/v1/datasources/${id}`);
};

export const updateDataSourceStatus = (id: number, status: string) => {
    return request.patch<unknown, void>(`/api/v1/datasources/${id}/status`, { status });
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
    return request.post<unknown, ConnectionTestResult>('/api/v1/datasources/test-connection', data, { params: { groupId } });
};

export const testExistingConnection = (id: number) => {
    return request.post<unknown, ConnectionTestResult>(`/api/v1/datasources/${id}/test`);
};
