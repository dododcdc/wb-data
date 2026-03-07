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

export const getMetadataTables = (dataSourceId: number) => {
    return request.get<TableMetadata[]>(`/api/v1/query/metadata/${dataSourceId}/tables`);
};

export const executeQuery = (dataSourceId: number, sql: string) => {
    return request.post<QueryResult>(`/api/v1/query/execute/${dataSourceId}`, sql, {
        headers: {
            'Content-Type': 'text/plain',
        },
    });
};
