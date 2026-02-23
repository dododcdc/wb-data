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
    connectionParams: Record<string, any>;
    status: string;
    owner: string;
    createdAt: string;
    updatedAt: string;
}

export interface DataSourceSearchQuery {
    page?: number;
    size?: number;
    keyword?: string;
    type?: string;
    typeList?: string[];
    status?: string;
}

export interface PageResult<T> {
    records: T[];
    total: number;
    size: number;
    current: number;
    pages: number;
}

export const getDataSourcePage = (params: DataSourceSearchQuery) => {
    return request.get<any, PageResult<DataSource>>('/api/v1/datasources', { params });
};

export const getDataSourceById = (id: number) => {
    return request.get<any, DataSource>(`/api/v1/datasources/${id}`);
};

export const createDataSource = (data: Partial<DataSource>) => {
    return request.post<any, boolean>('/api/v1/datasources', data);
};

export const updateDataSource = (id: number, data: Partial<DataSource>) => {
    return request.put<any, boolean>(`/api/v1/datasources/${id}`, data);
};

export const deleteDataSource = (id: number) => {
    return request.delete<any, boolean>(`/api/v1/datasources/${id}`);
};

export const updateDataSourceStatus = (id: number, status: string) => {
    return request.patch<any, void>(`/api/v1/datasources/${id}/status`, { status });
};

export const testNewConnection = (data: any) => {
    return request.post<any, boolean>('/api/v1/datasources/test-connection', data);
};

export const testExistingConnection = (id: number) => {
    return request.post<any, boolean>(`/api/v1/datasources/${id}/test`);
};
