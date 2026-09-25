import { describe, expect, it } from 'vitest';
import type { FlowParameterDefinitionSnapshot } from '../../api/offline';
import type { ParameterDefinition } from '../../api/parameterGroups';
import { diffParameterDefinitions } from './flowParameterDiff';

function snapshot(partial: Partial<FlowParameterDefinitionSnapshot> & { key: string }): FlowParameterDefinitionSnapshot {
    return {
        valueSource: 'CONSTANT',
        constantValue: '1',
        timeBasis: null,
        format: null,
        offsetDays: 0,
        description: null,
        sortOrder: 0,
        ...partial,
    };
}

function definition(partial: Partial<ParameterDefinition> & { key: string }): ParameterDefinition {
    return {
        valueSource: 'CONSTANT',
        constantValue: '1',
        timeBasis: null,
        format: null,
        offsetDays: 0,
        description: null,
        sortOrder: 0,
        ...partial,
    };
}

describe('diffParameterDefinitions', () => {
    it('returns empty when values are identical despite description changes', () => {
        const before = [snapshot({ key: 'v_day', description: null })];
        const after = [definition({ key: 'v_day', description: '通用日期' })];
        expect(diffParameterDefinitions(before, after)).toEqual([]);
    });

    it('detects added, removed and changed parameters', () => {
        const before = [
            snapshot({ key: 'removed_key', constantValue: 'old' }),
            snapshot({ key: 'changed_key', constantValue: '1' }),
        ];
        const after = [
            definition({ key: 'changed_key', constantValue: '2' }),
            definition({ key: 'added_key', constantValue: 'new' }),
        ];

        expect(diffParameterDefinitions(before, after)).toEqual([
            { key: 'removed_key', kind: 'removed', before: '固定值: old' },
            { key: 'changed_key', kind: 'changed', before: '固定值: 1', after: '固定值: 2' },
            { key: 'added_key', kind: 'added', after: '固定值: new' },
        ]);
    });

    it('detects time configuration changes', () => {
        const before = [snapshot({
            key: 'v_day', valueSource: 'SYSTEM_TIME', constantValue: null,
            timeBasis: 'PLANNED_TIME', format: 'yyyyMMdd', offsetDays: 0,
        })];
        const after = [definition({
            key: 'v_day', valueSource: 'SYSTEM_TIME', constantValue: null,
            timeBasis: 'EXECUTION_START_TIME', format: 'yyyyMMdd', offsetDays: -1,
        })];

        expect(diffParameterDefinitions(before, after)).toEqual([
            {
                key: 'v_day',
                kind: 'changed',
                before: '计划时间 · yyyyMMdd',
                after: '执行开始时间 · yyyyMMdd · -1 天',
            },
        ]);
    });
});
