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

export interface QueryResult {
    columns: ColumnMetadata[];
    rows: any[];
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
    return request.get<any, string[]>(`/api/v1/query/metadata/${dataSourceId}/databases`);
};

export const getMetadataTables = (dataSourceId: number, databaseName: string) => {
    return request.get<any, TableMetadata[]>(`/api/v1/query/metadata/${dataSourceId}/${databaseName}/tables`);
};

export const executeQuery = (dataSourceId: number, sql: string, database?: string) => {
    return request.post<any, QueryResult>(`/api/v1/query/execute/${dataSourceId}`, {
        sql,
        database
    }, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

export const getDialectMetadata = (dataSourceId: number) => {
    return request.get<any, DialectMetadata>(`/api/v1/query/metadata/${dataSourceId}/dialect`);
};
