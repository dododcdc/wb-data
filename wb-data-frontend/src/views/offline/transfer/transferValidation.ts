import type { TransferConfig, TransferFieldMapping, TransferPartitionMapping } from './transferTypes';

function isMapped(mapping: TransferFieldMapping | TransferPartitionMapping | undefined) {
    return Boolean(mapping && (mapping.source || mapping.value || mapping.expression));
}

export function validateTransferConfig(
    config: TransferConfig,
    targetColumns: string[],
    partitionColumns: string[],
    sourceColumns?: string[],
) {
    const errors: string[] = [];
    if (!config.source.dataSourceId) errors.push('请选择来源数据源');
    else if (!config.source.database) errors.push('请选择来源数据库');
    else if (!config.source.table) errors.push('请选择来源表');

    if (!config.target.dataSourceId) errors.push('请选择目标数据源');
    else if (!config.target.database) errors.push('请选择目标数据库');
    else if (!config.target.table) errors.push('请选择目标表');

    if (/^\s*where\b/i.test(config.source.where ?? '')) {
        errors.push('过滤条件无需填写 WHERE');
    }

    const endpointsComplete = Boolean(
        config.source.dataSourceId
        && config.source.database
        && config.source.table
        && config.target.dataSourceId
        && config.target.database
        && config.target.table,
    );
    const unmappedTargetColumns = endpointsComplete
        ? targetColumns.filter((target) => !isMapped(config.fieldMappings?.find((item) => item.target === target)))
        : [];
    const unmappedPartitionColumns = endpointsComplete && config.target.writeMode === 'overwrite_partition'
        ? partitionColumns.filter((target) => !isMapped(config.partitions?.find((item) => item.target === target)))
        : [];
    const targetNames = new Set(targetColumns);
    const partitionNames = new Set(partitionColumns);
    const sourceNames = sourceColumns ? new Set(sourceColumns) : null;
    const staleTargetMappings = endpointsComplete
        ? (config.fieldMappings ?? []).filter((mapping) => !targetNames.has(mapping.target))
        : [];
    const stalePartitionMappings = endpointsComplete
        ? (config.partitions ?? []).filter((mapping) => !partitionNames.has(mapping.target))
        : [];
    const invalidSourceMappings = endpointsComplete && sourceNames
        ? (config.fieldMappings ?? []).filter((mapping) => (
            targetNames.has(mapping.target)
            && mapping.kind === 'source_field'
            && Boolean(mapping.source)
            && !sourceNames.has(mapping.source ?? '')
        ))
        : [];
    const invalidPartitionSourceMappings = endpointsComplete && sourceNames
        ? (config.partitions ?? []).filter((mapping) => (
            partitionNames.has(mapping.target)
            && mapping.kind === 'source_field'
            && Boolean(mapping.source)
            && !sourceNames.has(mapping.source ?? '')
        ))
        : [];

    unmappedTargetColumns.forEach((target) => {
        errors.push(`目标字段 ${target} 尚未配置映射`);
    });
    unmappedPartitionColumns.forEach((target) => {
        errors.push(`分区字段 ${target} 尚未配置映射`);
    });
    invalidSourceMappings.forEach((mapping) => {
        errors.push(`来源字段 ${mapping.source} 已不存在`);
    });
    invalidPartitionSourceMappings.forEach((mapping) => {
        errors.push(`来源字段 ${mapping.source} 已不存在`);
    });
    staleTargetMappings.forEach((mapping) => {
        errors.push(`目标字段 ${mapping.target} 已不存在，请移除失效映射`);
    });
    stalePartitionMappings.forEach((mapping) => {
        errors.push(`分区字段 ${mapping.target} 已不存在，请移除失效映射`);
    });

    return {
        errors,
        valid: errors.length === 0,
        endpointsComplete,
        unmappedTargetColumns,
        unmappedPartitionColumns,
        invalidSourceMappings: invalidSourceMappings.map((mapping) => mapping.target),
        invalidPartitionSourceMappings: invalidPartitionSourceMappings.map((mapping) => mapping.target),
        staleTargetMappings: staleTargetMappings.map((mapping) => mapping.target),
        stalePartitionMappings: stalePartitionMappings.map((mapping) => mapping.target),
    };
}
