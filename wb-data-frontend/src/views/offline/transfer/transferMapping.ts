import type { TransferFieldMapping, TransferMappingKind, TransferPartitionMapping } from './transferTypes';

export function createDefaultFieldMappings(sourceColumns: string[], targetColumns: string[]): TransferFieldMapping[] {
    return reconcileTargetMappings([], sourceColumns, targetColumns);
}

export function reconcileTargetMappings<T extends TransferFieldMapping | TransferPartitionMapping>(
    currentMappings: T[] | undefined,
    sourceColumns: string[],
    targetColumns: string[],
): T[] {
    const sourceNames = new Set(sourceColumns);
    const currentByTarget = new Map((currentMappings ?? []).map((mapping) => [mapping.target, mapping]));
    const targetNames = new Set(targetColumns);

    const activeMappings = targetColumns.map((target) => {
        const current = currentByTarget.get(target);
        if (current) {
            if (current.kind === 'source_field' && !current.source && sourceNames.has(target)) {
                return { ...current, source: target };
            }
            return current;
        }
        return {
            target,
            kind: 'source_field',
            ...(sourceNames.has(target) ? { source: target } : {}),
        } as T;
    });

    const staleMappings = (currentMappings ?? []).filter((mapping) => !targetNames.has(mapping.target));
    return [...activeMappings, ...staleMappings];
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
