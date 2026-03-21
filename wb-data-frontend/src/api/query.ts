import request from '../utils/request';

export interface ColumnMetadata {
    name: string;
    type: string;
    size: number;
    nullable: boolean;
    remarks: string;
    primaryKey: boolean;
}

export interface TableMetadata {
    name: string;
    type: string;
    remarks: string;
    columns: ColumnMetadata[];
}

export interface TableSummary {
    name: string;
    type: string;
    remarks: string;
}

export interface PageResult<T> {
    data: T[];
    total: number;
    page: number;
    size: number;
}

export interface QueryResult {
    columns: ColumnMetadata[];
    rows: Record<string, unknown>[];
    executionTimeMs: number;
    message: string;
}

export interface FunctionMetadata {
    name: string;
    description: string;
    signature: string;
}

export interface DialectMetadata {
    keywords: string[];
    functions: FunctionMetadata[];
    dataTypes: string[];
}

export const getMetadataDatabases = (dataSourceId: number) => {
    return request.get<unknown, string[]>(`/api/v1/query/metadata/${dataSourceId}/databases`);
};

export const getMetadataTables = (dataSourceId: number, databaseName: string, keyword?: string, page?: number, size?: number) => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (page !== undefined) params.set('page', String(page));
    if (size !== undefined) params.set('size', String(size));
    const qs = params.toString();
    return request.get<unknown, PageResult<TableSummary>>(`/api/v1/query/metadata/${dataSourceId}/${databaseName}/tables${qs ? '?' + qs : ''}`);
};

export const getMetadataColumns = (dataSourceId: number, databaseName: string, tableName: string) => {
    return request.get<unknown, ColumnMetadata[]>(`/api/v1/query/metadata/${dataSourceId}/${databaseName}/tables/${encodeURIComponent(tableName)}/columns`);
};

export const executeQuery = (dataSourceId: number, sql: string, database?: string) => {
    return request.post<unknown, QueryResult>(`/api/v1/query/execute/${dataSourceId}`, {
        sql,
        database
    }, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const getDialectMetadata = (dataSourceId: number) => {
    return request.get<unknown, DialectMetadata>(`/api/v1/query/metadata/${dataSourceId}/dialect`);
};
