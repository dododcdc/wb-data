import type { TransferFieldMapping, TransferMappingKind, TransferPartitionMapping } from './transferTypes';

export function createDefaultFieldMappings(sourceColumns: string[], targetColumns: string[]): TransferFieldMapping[] {
    const sourceNames = new Set(sourceColumns);
    return targetColumns.map((target) => ({
        target,
        kind: 'source_field',
        ...(sourceNames.has(target) ? { source: target } : {}),
    }));
}

export function updateMapping(
    mappings: Array<TransferFieldMapping | TransferPartitionMapping>,
    target: string,
    kind: TransferMappingKind,
    value: string,
) {
    return mappings.map((mapping) => mapping.target !== target ? mapping : {
        target,
        kind,
        ...(kind === 'source_field' ? { source: value } : {}),
        ...(kind === 'static_value' ? { value } : {}),
        ...(kind === 'source_expression' ? { expression: value } : {}),
    });
}
