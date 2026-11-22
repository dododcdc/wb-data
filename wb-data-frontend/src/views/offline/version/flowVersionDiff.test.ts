import { describe, expect, it } from 'vitest';

import type { OfflineFlowDocument, OfflineFlowNode, OfflineFlowVersionSnapshot } from '../../../api/offline';
import { countTotalSemanticChanges, diffFlowVersions, getNodeChangeReasons, hasNodeChanges } from './flowVersionDiff';
import { areTransferEndpointFieldsEqual, buildWorktreeVersionSelection } from './versionComparePresentation';

function node(taskId: string, overrides: Partial<OfflineFlowNode> = {}): OfflineFlowNode {
    return { taskId, kind: 'SHELL', scriptContent: `echo ${taskId}`, ...overrides };
}

function document(nodes: OfflineFlowNode[], overrides: Partial<OfflineFlowDocument> = {}): OfflineFlowDocument {
    return {
        groupId: 4,
        path: '_flows/example/flow.yaml',
        flowId: 'example',
        namespace: 'pg-4',
        documentHash: 'hash',
        documentUpdatedAt: 0,
        stages: [{ stageId: 'stage-1', parallel: false, nodes }],
        edges: [],
        layout: {},
        ...overrides,
    };
}

function snapshot(doc: OfflineFlowDocument, metadata: OfflineFlowVersionSnapshot['nodeMetadata'] = {}): OfflineFlowVersionSnapshot {
    return { revision: 'rev', document: doc, files: [], nodeMetadata: metadata };
}

describe('diffFlowVersions', () => {
    it('classifies node and edge changes by stable task id', () => {
        const base = snapshot(document([
            node('a'),
            node('b'),
        ], {
            edges: [{ source: 'a', target: 'b' }],
        }));
        const target = snapshot(document([
            node('a', { dataSourceId: 9 }),
            node('c'),
        ], {
            edges: [{ source: 'a', target: 'c' }],
        }));

        const result = diffFlowVersions(base, target);
        const a = result.nodes.find((entry) => entry.taskId === 'a')!;
        const b = result.nodes.find((entry) => entry.taskId === 'b')!;
        const c = result.nodes.find((entry) => entry.taskId === 'c')!;

        expect(a.kind).toBe('MODIFIED');
        expect(a.contentChanged).toBe(false);
        expect(a.configChanged).toBe(true);
        expect(a.upstreamChanged).toBe(false);
        expect(b.upstreamChanged).toBe(true);
        expect(c.upstreamChanged).toBe(true);
        expect(b.kind).toBe('REMOVED');
        expect(c.kind).toBe('ADDED');
        expect(result.edges[0].kind).toBe('REMOVED');
        expect(result.edges[1].kind).toBe('ADDED');
        expect(result.summary.nodes).toBe(3);
    });

    it('compares schedule dependencies parameters and impacted nodes', () => {
        const oldDefinition = {
            key: 'v_day', valueSource: 'CONSTANT' as const, constantValue: '20261107', offsetDays: 0, sortOrder: 0,
        };
        const newDefinition = {
            ...oldDefinition, constantValue: '20261108',
        };
        const base = snapshot(document([node('a')], {
            schedule: { cron: '0 1 * * *', timezone: 'Asia/Shanghai', enabled: true, period: 'DAILY' },
            dependencyConfig: { dependencies: [], failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW' },
            parameterBinding: {
                parameterGroupId: 7,
                code: 'common',
                boundVersion: 1,
                status: 'CURRENT',
                definitions: [oldDefinition],
            },
        }), { a: { referencedParameters: ['v_day'] } });
        const target = snapshot(document([node('a')], {
            schedule: { cron: '0 2 * * *', timezone: 'UTC', enabled: false, period: 'DAILY' },
            dependencyConfig: {
                dependencies: [{ groupId: 3, flowId: 'upstream' }],
                failurePolicy: 'PAUSE',
                crossGroupDependency: 'DENY',
            },
            parameterBinding: {
                parameterGroupId: 7,
                code: 'common',
                boundVersion: 2,
                status: 'CURRENT',
                definitions: [newDefinition],
            },
        }), { a: { referencedParameters: ['v_day'] } });

        const result = diffFlowVersions(base, target);

        expect(result.schedule.map((field) => field.field)).toEqual(['cron', 'timezone', 'enabled']);
        expect(result.dependencies.items).toHaveLength(1);
        expect(result.dependencies.fields.map((field) => field.field)).toEqual(['failurePolicy', 'crossGroupDependency']);
        expect(result.parameters.groups[0]).toMatchObject({ baseVersion: 1, targetVersion: 2 });
        expect(result.parameters.definitions[0]).toMatchObject({
            key: '7:v_day',
            kind: 'MODIFIED',
            impactedTaskIds: ['a'],
        });
        expect(result.summary).toEqual({ nodes: 0, schedule: 3, dependencies: 3, parameters: 2 });
    });

    it('ignores layout and exposes referenced parameter changes', () => {
        const base = snapshot(document([node('a')], {
            layout: { a: { x: 0, y: 0 } },
        }), { a: { referencedParameters: ['old'] } });
        const target = snapshot(document([node('a')], {
            layout: { a: { x: 500, y: 500 } },
        }), { a: { referencedParameters: ['new'] } });

        const result = diffFlowVersions(base, target);
        expect(result.nodes[0].referencedParametersAdded).toEqual(['new']);
        expect(result.nodes[0].referencedParametersRemoved).toEqual(['old']);
        expect(result.nodes[0].structureChanged).toBe(false);
    });

    it('resolves impacted tasks from structured nodeMetadata and detects scriptPath changes', () => {
        const base = snapshot(
            document([node('sql_a', { scriptPath: 'scripts/old.sql' })], {
                parameterBinding: {
                    parameterGroupId: 1,
                    code: 'biz',
                    name: '业务参数',
                    boundVersion: 1,
                    definitions: [{ key: 'v_day', valueSource: 'CONSTANT', constantValue: '20261113', offsetDays: 0, sortOrder: 0 }],
                } as OfflineFlowDocument['parameterBinding'],
            }),
            { sql_a: { referencedParameters: ['v_day'] } },
        );
        const target = snapshot(
            document([node('sql_a', { scriptPath: 'scripts/new.sql' })], {
                parameterBinding: {
                    parameterGroupId: 1,
                    code: 'biz',
                    name: '业务参数',
                    boundVersion: 2,
                    definitions: [{ key: 'v_day', valueSource: 'CONSTANT', constantValue: '20261114', offsetDays: 0, sortOrder: 0 }],
                } as OfflineFlowDocument['parameterBinding'],
            }),
            { sql_a: { referencedParameters: ['v_day'] } },
        );

        const result = diffFlowVersions(base, target);
        expect(result.parameters.definitions[0].impactedTaskIds).toEqual(['sql_a']);
        expect(result.nodes[0].scriptPathChanged).toBe(true);
        expect(getNodeChangeReasons(result.nodes[0])).toContain('脚本路径');
    });

    it('compares transfer preSql and postSql arrays by value rather than reference', () => {
        expect(areTransferEndpointFieldsEqual('preSql', ['DELETE FROM t WHERE id = 1'], ['DELETE FROM t WHERE id = 1'])).toBe(true);
        expect(areTransferEndpointFieldsEqual('preSql', undefined, [])).toBe(true);
        expect(areTransferEndpointFieldsEqual('postSql', ['ANALYZE TABLE t'], ['OPTIMIZE TABLE t'])).toBe(false);
    });

    it('omits unchanged edges and upstream dependencies present in both revisions', () => {
        const docOverrides = {
            edges: [{ source: 'hive_a', target: 'transfer_b' }, { source: 'transfer_b', target: 'shell_c' }],
            dependencyConfig: {
                dependencies: [{ groupId: 4, groupName: 'policy', flowId: 'upstream_flow', flowName: '上游' }],
                failurePolicy: 'PAUSE' as const,
                crossGroupDependency: 'ALLOW' as const,
            },
        };
        const base = snapshot(document([node('hive_a'), node('transfer_b'), node('shell_c')], docOverrides));
        const target = snapshot(document([node('hive_a'), node('transfer_b'), node('shell_c')], docOverrides));

        const result = diffFlowVersions(base, target);
        expect(result.edges).toEqual([]);
        expect(result.dependencies.items).toEqual([]);
        expect(result.summary).toEqual({ nodes: 0, schedule: 0, dependencies: 0, parameters: 0 });
    });

    it('marks HIVE_SQL hiveConf differences in node diff summary and change reasons', () => {
        const base = snapshot(document([
            node('hive_a', {
                kind: 'HIVE_SQL',
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                hiveConf: { 'hive.exec.dynamic.partition': 'true' },
            }),
        ]));
        const target = snapshot(document([
            node('hive_a', {
                kind: 'HIVE_SQL',
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                hiveConf: {
                    'hive.exec.dynamic.partition': 'true',
                    'hive.exec.dynamic.partition.mode': 'nonstrict',
                },
            }),
        ]));

        const result = diffFlowVersions(base, target);
        expect(result.summary.nodes).toBe(1);
        expect(result.nodes[0].hiveConfChanged).toBe(true);
        expect(getNodeChangeReasons(result.nodes[0])).toEqual(['Hive 运行参数']);
    });

    it('treats reordered HIVE_SQL hiveConf entries as unchanged to match structured diff', () => {
        const base = snapshot(document([
            node('hive_a', {
                kind: 'HIVE_SQL',
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                hiveConf: {
                    'hive.exec.dynamic.partition': 'true',
                    'hive.exec.dynamic.partition.mode': 'nonstrict',
                },
            }),
        ]));
        const target = snapshot(document([
            node('hive_a', {
                kind: 'HIVE_SQL',
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                hiveConf: {
                    'hive.exec.dynamic.partition.mode': 'nonstrict',
                    'hive.exec.dynamic.partition': 'true',
                },
            }),
        ]));

        const result = diffFlowVersions(base, target);
        expect(result.nodes[0].hiveConfChanged).toBe(false);
        expect(hasNodeChanges(result.nodes[0])).toBe(false);
        expect(result.summary.nodes).toBe(0);
        expect(countTotalSemanticChanges(result)).toBe(0);
    });

    it('excludes upstream-only edge changes from node modification summary while keeping detail reason', () => {
        const base = snapshot(document([node('a'), node('b')], { edges: [] }));
        const target = snapshot(document([node('a'), node('b')], { edges: [{ source: 'a', target: 'b' }] }));

        const result = diffFlowVersions(base, target);
        const downstream = result.nodes.find((entry) => entry.taskId === 'b')!;
        expect(downstream.upstreamChanged).toBe(true);
        expect(hasNodeChanges(downstream)).toBe(false);
        expect(result.summary.nodes).toBe(0);
        expect(result.edges).toHaveLength(1);
        expect(getNodeChangeReasons(downstream)).toContain('上游连线');
    });

    it('avoids falsely marking worktree clean when development metadata is absent', () => {
        expect(buildWorktreeVersionSelection(undefined).message).toBeNull();
        expect(buildWorktreeVersionSelection({ dirty: true }).message).toBe('工作区有未提交修改');
        expect(buildWorktreeVersionSelection({ dirty: false }).message).toBe('与最新提交一致');
    });
});
