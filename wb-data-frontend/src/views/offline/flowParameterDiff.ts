import type { FlowParameterDefinitionSnapshot } from '../../api/offline';
import type { ParameterDefinition } from '../../api/parameterGroups';

export interface ParameterDefinitionLike {
    key: string;
    valueSource: 'CONSTANT' | 'SYSTEM_TIME';
    constantValue?: string | null;
    timeBasis?: 'PLANNED_TIME' | 'EXECUTION_START_TIME' | null;
    format?: string | null;
    offsetDays: number;
}

export type ParameterDiffKind = 'added' | 'removed' | 'changed';

export interface ParameterDiffEntry {
    key: string;
    kind: ParameterDiffKind;
    before?: string;
    after?: string;
}

export function describeParameterDefinition(definition: ParameterDefinitionLike) {
    if (definition.valueSource === 'CONSTANT') {
        return definition.constantValue != null && definition.constantValue !== ''
            ? `固定值: ${definition.constantValue}`
            : '固定值';
    }
    const basis = definition.timeBasis === 'EXECUTION_START_TIME' ? '执行开始时间' : '计划时间';
    const offset = definition.offsetDays === 0
        ? ''
        : ` · ${definition.offsetDays > 0 ? '+' : ''}${definition.offsetDays} 天`;
    return `${basis} · ${definition.format || 'yyyyMMdd'}${offset}`;
}

function sameValueSemantics(a: ParameterDefinitionLike, b: ParameterDefinitionLike) {
    return a.valueSource === b.valueSource
        && (a.constantValue ?? null) === (b.constantValue ?? null)
        && (a.timeBasis ?? null) === (b.timeBasis ?? null)
        && (a.format ?? null) === (b.format ?? null)
        && a.offsetDays === b.offsetDays;
}

export function diffParameterDefinitions(
    before: FlowParameterDefinitionSnapshot[],
    after: ParameterDefinition[],
): ParameterDiffEntry[] {
    const entries: ParameterDiffEntry[] = [];
    const afterByKey = new Map(after.map((definition) => [definition.key, definition]));

    for (const oldDefinition of before) {
        const next = afterByKey.get(oldDefinition.key);
        if (!next) {
            entries.push({ key: oldDefinition.key, kind: 'removed', before: describeParameterDefinition(oldDefinition) });
        } else if (!sameValueSemantics(oldDefinition, next)) {
            entries.push({
                key: oldDefinition.key,
                kind: 'changed',
                before: describeParameterDefinition(oldDefinition),
                after: describeParameterDefinition(next),
            });
        }
    }

    const beforeKeys = new Set(before.map((definition) => definition.key));
    for (const next of after) {
        if (!beforeKeys.has(next.key)) {
            entries.push({ key: next.key, kind: 'added', after: describeParameterDefinition(next) });
        }
    }

    return entries;
}
