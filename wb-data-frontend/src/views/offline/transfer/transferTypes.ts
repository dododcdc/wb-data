export type TransferDataSourceType = 'MYSQL' | 'POSTGRESQL' | 'STARROCKS' | 'HIVE';

export type TransferMappingKind = 'source_field' | 'static_value' | 'source_expression';

export type TransferWriteMode = 'append' | 'overwrite_table' | 'overwrite_partition';
export type TransferNonPartitionedWriteMode = Exclude<TransferWriteMode, 'overwrite_partition'>;

export const transferMappingKinds: TransferMappingKind[] = [
    'source_field',
    'static_value',
    'source_expression',
];

const nonPartitionedTransferWriteModes: TransferNonPartitionedWriteMode[] = [
    'append',
    'overwrite_table',
];

const partitionedTransferWriteModes: TransferWriteMode[] = [
    'append',
    'overwrite_partition',
];

export function getTransferWriteModes(hasPartitionMappings: boolean): readonly TransferWriteMode[] {
    return hasPartitionMappings ? partitionedTransferWriteModes : nonPartitionedTransferWriteModes;
}

export interface TransferEndpointConfig {
    dataSourceId: number;
    dataSourceType: TransferDataSourceType;
    database?: string;
    table: string;
    where?: string;
    writeMode?: TransferWriteMode;
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
