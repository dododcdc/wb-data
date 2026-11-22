import type {
    TransferDataSourceType,
    TransferMappingKind,
    TransferNonPartitionedWriteMode,
    TransferWriteMode,
} from '@/types/transfer';

export type {
    TransferConfig,
    TransferDataSourceType,
    TransferEndpointConfig,
    TransferFieldMapping,
    TransferMappingKind,
    TransferNonPartitionedWriteMode,
    TransferPartitionMapping,
    TransferWriteMode,
} from '@/types/transfer';

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

export const MAX_TRANSFER_SQL_STATEMENTS = 5;

export function supportsTransferSql(type: TransferDataSourceType): boolean {
    return type === 'MYSQL' || type === 'POSTGRESQL' || type === 'CLICKHOUSE';
}
