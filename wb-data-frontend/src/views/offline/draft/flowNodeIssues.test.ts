import { describe, expect, it } from 'vitest';
import type { OfflineExecutionDetail, OfflineFlowDocument } from '../../../api/offline';
import {
    computeExecutionNodeStatuses,
    computeFlowNodeIssues,
    filterActiveRollbackIssues,
} from './flowNodeIssues';

function makeDocument(nodes: OfflineFlowDocument['stages'][number]['nodes']): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/demo/flow.yaml',
        flowId: 'demo',
        namespace: 'demo',
        documentHash: 'hash',
        documentUpdatedAt: 100,
        runtimeTimezone: 'Asia/Shanghai',
        stages: [{ stageId: 'stage_1', parallel: false, nodes }],
        edges: [],
        layout: {},
    };
}

describe('flowNodeIssues', () => {
    it('filters out rollback issues for removed nodes and blank messages', () => {
        const doc = makeDocument([
            { taskId: 'sql_a', kind: 'MYSQL', dataSourceId: 1, dataSourceType: 'MYSQL' },
            { taskId: 'shell_b', kind: 'SHELL' },
        ]);

        expect(filterActiveRollbackIssues(null, { sql_a: 'missing' })).toEqual({});
        expect(filterActiveRollbackIssues(doc, {
            sql_a: '旧数据源不存在',
            removed_node: '已删除',
            shell_b: '',
        })).toEqual({
            sql_a: '旧数据源不存在',
        });
    });

    it('reports transfer, SQL datasource, and active rollback issues in precedence order', () => {
        const doc = makeDocument([
            { taskId: 'transfer_incomplete', kind: 'TRANSFER' },
            { taskId: 'sql_missing_ds', kind: 'MYSQL' },
            { taskId: 'sql_rollback_issue', kind: 'MYSQL', dataSourceId: 9, dataSourceType: 'MYSQL' },
            { taskId: 'shell_ok', kind: 'SHELL' },
        ]);

        const issues = computeFlowNodeIssues(doc, {
            sql_missing_ds: 'rollback reason should yield to missing datasource',
            sql_rollback_issue: '历史版本引用的数据源已停用',
        });

        expect(issues.transfer_incomplete).toBe('Transfer 配置未完成');
        expect(issues.sql_missing_ds).toBeTruthy();
        expect(issues.sql_rollback_issue).toBe('历史版本引用的数据源已停用');
        expect(issues.shell_ok).toBeUndefined();
        expect(computeFlowNodeIssues(null, {})).toEqual({});
    });

    it('maps execution task runs to task status lookup', () => {
        const detail = {
            taskRuns: [
                { taskId: 'a', status: 'SUCCESS', startDate: null, endDate: null },
                { taskId: 'b', status: 'FAILED', startDate: null, endDate: null },
            ],
        } as unknown as OfflineExecutionDetail;

        expect(computeExecutionNodeStatuses(null)).toEqual({});
        expect(computeExecutionNodeStatuses(detail)).toEqual({
            a: 'SUCCESS',
            b: 'FAILED',
        });
    });
});
