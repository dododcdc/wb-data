import type { TransferConfig, TransferFieldMapping, TransferPartitionMapping } from './transferTypes';

function isMapped(mapping: TransferFieldMapping | TransferPartitionMapping | undefined) {
    return Boolean(mapping && (mapping.source || mapping.value || mapping.expression));
}

export function validateTransferConfig(config: TransferConfig, targetColumns: string[], partitionColumns: string[]) {
    const errors: string[] = [];
    if (!config.source.dataSourceId || !config.source.table) errors.push('请选择来源数据源和表');
    if (!config.target.dataSourceId || !config.target.table) errors.push('请选择目标数据源和表');
    targetColumns.forEach((target) => {
        if (!isMapped(config.fieldMappings?.find((item) => item.target === target))) {
            errors.push(`目标字段 ${target} 尚未配置映射`);
        }
    });
    if (config.target.writeMode === 'overwrite_partition') {
        partitionColumns.forEach((target) => {
            if (!isMapped(config.partitions?.find((item) => item.target === target))) {
                errors.push(`分区字段 ${target} 尚未配置映射`);
            }
        });
    }
    return { errors, valid: errors.length === 0 };
}
