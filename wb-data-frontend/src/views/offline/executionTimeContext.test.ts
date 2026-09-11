import { describe, expect, it } from 'vitest';
import type { OfflineFlowDocument } from '../../api/offline';
import { defaultPlannedTimeValue, getExecutionTimeRequirement } from './executionTimeContext';

function documentWithPlannedParameter(): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/example/flow.yaml',
        flowId: 'example',
        namespace: 'g1-main',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        runtimeTimezone: 'Asia/Shanghai',
        stages: [{
            stageId: 'stage_1',
            parallel: false,
            nodes: [{
                taskId: 'query',
                kind: 'SQL',
                scriptPath: 'scripts/query.sql',
                scriptContent: 'select 1',
                dataSourceId: 1,
                dataSourceType: 'MYSQL',
            }],
        }],
        edges: [],
        layout: {},
        parameterBinding: {
            parameterGroupId: 12,
            code: 'daily_common',
            boundVersion: 3,
            currentVersion: 3,
            status: 'CURRENT',
            definitions: [{
                key: 'v_day',
                valueSource: 'SYSTEM_TIME',
                format: 'yyyyMMdd',
                offsetDays: 0,
                timeBasis: 'PLANNED_TIME',
                sortOrder: 0,
            }],
        },
    };
}

describe('getExecutionTimeRequirement', () => {
    it('requires planned time from the Flow definition without parsing selected nodes', () => {
        const document = documentWithPlannedParameter();

        expect(getExecutionTimeRequirement(document)).toEqual({
            requiresConfiguration: true,
            requiresPlannedTime: true,
            timezone: 'Asia/Shanghai',
            parameterKeys: ['v_day'],
        });
    });

    it('opens parameter configuration without requiring planned time for constant-only parameters', () => {
        const document = documentWithPlannedParameter();
        document.parameterBinding!.definitions = [{
            key: 'tenant_name',
            valueSource: 'CONSTANT',
            constantValue: 'tom',
            offsetDays: 0,
            sortOrder: 0,
        }];

        expect(getExecutionTimeRequirement(document)).toEqual({
            requiresConfiguration: true,
            requiresPlannedTime: false,
            timezone: null,
            parameterKeys: [],
        });
    });
});

describe('defaultPlannedTimeValue', () => {
    it('formats the current wall-clock time in the given timezone', () => {
        const value = defaultPlannedTimeValue('Asia/Shanghai');

        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        const shanghaiNow = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
        expect(value.startsWith(shanghaiNow)).toBe(true);
    });

    it('falls back to Asia/Shanghai when the timezone is invalid', () => {
        const value = defaultPlannedTimeValue('Not/AZone');

        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
});
