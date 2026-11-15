import { describe, expect, it } from 'vitest';
import type { OfflineFlowDocument } from '../../api/offline';
import { buildDraftExecutionRequest } from './draftExecution';

describe('buildDraftExecutionRequest', () => {
    it('forwards hiveConf on HIVE_SQL nodes for draft debug execution', () => {
        const doc: OfflineFlowDocument = {
            groupId: 1,
            path: '_flows/demo/flow.yaml',
            flowId: 'demo',
            namespace: 'pg-1',
            documentHash: 'hash-1',
            documentUpdatedAt: 100,
            stages: [{
                stageId: 'main',
                parallel: false,
                nodes: [{
                    taskId: 'hive_1',
                    kind: 'HIVE_SQL',
                    scriptPath: 'scripts/demo/hive_1.sql',
                    scriptContent: 'SELECT 1;',
                    dataSourceId: 2,
                    dataSourceType: 'HIVE',
                    hiveConf: {
                        'hive.exec.dynamic.partition': 'true',
                        'hive.exec.dynamic.partition.mode': 'nonstrict',
                    },
                }],
            }],
            edges: [],
            layout: { hive_1: { x: 100, y: 100 } },
        };

        const req = buildDraftExecutionRequest({
            groupId: 1,
            flowPath: '_flows/demo/flow.yaml',
            flowDocument: doc,
            canvasNodes: [],
            canvasEdges: [],
            selectedTaskIds: ['hive_1'],
        });

        expect(req.stages[0].nodes[0].hiveConf).toEqual({
            'hive.exec.dynamic.partition': 'true',
            'hive.exec.dynamic.partition.mode': 'nonstrict',
        });
    });
});
