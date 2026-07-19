import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';

import type { OfflineFlowDocument } from '../../api/offline';
import {
    buildSaveFlowDocumentRequest,
    hasPendingNodeEditorDraftChanges,
    isSaveConflictError,
    prepareFlowSessionForSave,
} from './flowSaveTransaction';
import { createFlowDraftSession, type PendingNodeEditorDraft } from './flowDraftController';

function makeFlowDocument(overrides?: Partial<OfflineFlowDocument>): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/jack/demo/flow.yaml',
        flowId: 'demo',
        namespace: 'jack.demo',
        documentHash: 'server-hash',
        documentUpdatedAt: 10,
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes: [
                    {
                        taskId: 'shell_node_1',
                        kind: 'SHELL',
                        scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                        scriptContent: 'server content',
                    },
                ],
            },
        ],
        edges: [{ source: 'shell_node_1', target: 'shell_node_2' }],
        layout: {
            shell_node_1: { x: 0, y: 0 },
        },
        schedule: {
            cron: '0 2 * * *',
            timezone: 'Asia/Shanghai',
            enabled: true,
        },
        ...overrides,
    };
}

function makeSession(document = makeFlowDocument()) {
    return createFlowDraftSession({
        path: '_flows/jack/demo/flow.yaml',
        serverDocument: document,
        snapshot: null,
    });
}

describe('flowSaveTransaction', () => {
    it('builds a save request from the draft while preserving base document version fields', () => {
        const session = makeSession(makeFlowDocument({
            documentHash: 'base-hash',
            documentUpdatedAt: 20,
            stages: [
                {
                    stageId: 'main',
                    parallel: false,
                    nodes: [
                        {
                            taskId: 'sql_node_1',
                            kind: 'SQL',
                            scriptPath: 'scripts/jack/demo/sql_node_1.sql',
                            scriptContent: 'select 1',
                            dataSourceId: 42,
                            dataSourceType: 'MYSQL',
                        },
                    ],
                },
            ],
        }));

        const request = buildSaveFlowDocumentRequest(1, session);

        expect(request).toEqual({
            groupId: 1,
            path: '_flows/jack/demo/flow.yaml',
            documentHash: 'base-hash',
            documentUpdatedAt: 20,
            stages: [
                {
                    stageId: 'main',
                    nodes: [
                        {
                            taskId: 'sql_node_1',
                            kind: 'SQL',
                            scriptPath: 'scripts/jack/demo/sql_node_1.sql',
                            scriptContent: 'select 1',
                            dataSourceId: 42,
                            dataSourceType: 'MYSQL',
                        },
                    ],
                },
            ],
            edges: [{ source: 'shell_node_1', target: 'shell_node_2' }],
            layout: {
                shell_node_1: { x: 0, y: 0 },
            },
            schedule: {
                cron: '0 2 * * *',
                timezone: 'Asia/Shanghai',
                enabled: true,
            },
        });
    });

    it('preserves transfer configuration when serializing a transfer node', () => {
        const transfer = {
            source: {
                dataSourceId: 11,
                dataSourceType: 'MYSQL' as const,
                table: 'orders',
            },
            target: {
                dataSourceId: 12,
                dataSourceType: 'HIVE' as const,
                table: 'dwd_orders',
                writeMode: 'overwrite_partition' as const,
            },
            fieldMappings: [
                { target: 'order_id', kind: 'source_field' as const, source: 'id' },
            ],
            partitions: [
                { target: 'dt', kind: 'static_value' as const, value: '2026-07-19' },
            ],
        };
        const session = makeSession(makeFlowDocument({
            stages: [{
                stageId: 'main',
                parallel: false,
                nodes: [{ taskId: 'transfer_orders', kind: 'TRANSFER', transfer }],
            }],
        }));

        const request = buildSaveFlowDocumentRequest(1, session);

        expect(request.stages[0].nodes[0]).toMatchObject({
            taskId: 'transfer_orders',
            kind: 'TRANSFER',
            transfer,
        });
    });

    it('prepares a save session by flushing pending editor draft content', () => {
        const pendingDraft: PendingNodeEditorDraft = {
            taskId: 'shell_node_1',
            scriptContent: 'edited content',
            dataSourceId: 7,
            dataSourceType: 'POSTGRESQL',
        };

        const prepared = prepareFlowSessionForSave({
            session: makeSession(),
            pendingDraft,
        });

        expect(prepared.nodeOverride).toEqual({
            taskId: 'shell_node_1',
            content: 'edited content',
            dataSourceId: 7,
            dataSourceType: 'POSTGRESQL',
        });
        expect(prepared.sessionForSave.workingDraft.stages[0].nodes[0]).toEqual(expect.objectContaining({
            scriptContent: 'edited content',
            dataSourceId: 7,
            dataSourceType: 'POSTGRESQL',
        }));
    });

    it('detects pending editor draft changes against the current draft document', () => {
        const session = makeSession();

        expect(hasPendingNodeEditorDraftChanges(session, {
            taskId: 'shell_node_1',
            scriptContent: 'server content',
        })).toBe(false);
        expect(hasPendingNodeEditorDraftChanges(session, {
            taskId: 'shell_node_1',
            scriptContent: 'edited content',
        })).toBe(true);
    });

    it('recognizes HTTP 409 save conflicts', () => {
        const conflict = new AxiosError('conflict', undefined, undefined, undefined, {
            data: {},
            status: 409,
            statusText: 'Conflict',
            headers: {},
            config: { headers: {} } as InternalAxiosRequestConfig,
        });

        expect(isSaveConflictError(conflict)).toBe(true);
        expect(isSaveConflictError(new Error('other'))).toBe(false);
    });
});
