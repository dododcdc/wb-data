import { describe, expect, it } from 'vitest';

import type { OfflineFlowDocument, OfflineFlowNode, OfflineFlowVersionSnapshot } from '../../api/offline';
import { diffFlowVersions } from './flowVersionDiff';

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
});
