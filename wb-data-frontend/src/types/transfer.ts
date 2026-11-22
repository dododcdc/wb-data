export type TransferDataSourceType = 'MYSQL' | 'POSTGRESQL' | 'CLICKHOUSE' | 'HIVE';

export type TransferMappingKind = 'source_field' | 'static_value' | 'source_expression';

export type TransferWriteMode = 'append' | 'overwrite_table' | 'overwrite_partition';
export type TransferNonPartitionedWriteMode = Exclude<TransferWriteMode, 'overwrite_partition'>;

export interface TransferEndpointConfig {
    dataSourceId: number;
    dataSourceType: TransferDataSourceType;
    database?: string;
    table: string;
    where?: string;
    writeMode?: TransferWriteMode;
    preSql?: string[];
    postSql?: string[];
}

export interface TransferFieldMapping {
    target: string;
    kind: TransferMappingKind;
    source?: string;
    expression?: string;
    value?: string;
}

export interface TransferPartitionMapping {
    target: string;
    kind: TransferMappingKind;
    source?: string;
    expression?: string;
    value?: string;
}

export interface TransferConfig {
    source: TransferEndpointConfig;
    target: TransferEndpointConfig;
    fieldMappings?: TransferFieldMapping[];
    partitions?: TransferPartitionMapping[];
}
