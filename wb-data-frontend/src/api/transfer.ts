import request from '../utils/request';
import { groupScopedPath } from './groupScoped';
import type { ColumnMetadata, PageResult, TableSummary } from './query';

export interface PartitionColumnMetadata {
    name: string;
    type: string;
    remarks: string;
}

export interface TransferWriteModeOption {
    value: 'append' | 'overwrite_table' | 'overwrite_partition';
    label: string;
}

export interface TransferTableMetadataResponse {
    columns: ColumnMetadata[];
    partitionColumns: PartitionColumnMetadata[];
    partitioned: boolean;
    writeModes: TransferWriteModeOption[];
}

export interface TransferTableQuery {
    databaseName?: string;
    keyword?: string;
    page?: number;
    size?: number;
}

export const getTransferTables = (groupId: number, dataSourceId: number, params: TransferTableQuery) => {
    return request.get<unknown, PageResult<TableSummary>>(
        groupScopedPath(groupId, `/offline/transfer/datasources/${dataSourceId}/tables`),
        { params },
    );
};

export const getTransferTableMetadata = (groupId: number, dataSourceId: number, databaseName: string, tableName: string) => {
    return request.get<unknown, TransferTableMetadataResponse>(
        groupScopedPath(groupId, `/offline/transfer/datasources/${dataSourceId}/tables/${encodeURIComponent(tableName)}/metadata`),
        { params: { databaseName } },
    );
};
