import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => ({
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
}));

vi.mock('../utils/request', () => ({
    default: requestMock,
}));

import {
    createOfflineDocumentDebugExecution,
    getOfflineRepoStatus,
    saveOfflineFlowDocument,
    updateOfflineScheduleStatus,
} from './offline';

describe('offline API group-scoped routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the group-scoped route for repo status', async () => {
        await getOfflineRepoStatus(4);

        expect(requestMock.get).toHaveBeenCalledWith('/api/v1/groups/4/offline/repo/status');
    });

    it('uses the group-scoped route and omits groupId from document save body', async () => {
        await saveOfflineFlowDocument({
            groupId: 4,
            path: '_flows/jack/test/flow.yaml',
            documentHash: 'hash',
            documentUpdatedAt: 100,
            stages: [],
            edges: [],
            layout: {},
            runtimeTimezone: 'Asia/Shanghai',
        });

        expect(requestMock.put).toHaveBeenCalledWith(
            '/api/v1/groups/4/offline/flows/document',
            {
                path: '_flows/jack/test/flow.yaml',
                documentHash: 'hash',
                documentUpdatedAt: 100,
                stages: [],
                edges: [],
                layout: {},
                runtimeTimezone: 'Asia/Shanghai',
            },
            { headers: { 'Content-Type': 'application/json' } },
        );
    });

    it('sends an explicit parameter binding change', async () => {
        await saveOfflineFlowDocument({
            groupId: 4,
            path: '_flows/jack/test/flow.yaml',
            documentHash: 'hash',
            documentUpdatedAt: 100,
            stages: [],
            runtimeTimezone: 'Asia/Shanghai',
            parameterBinding: {
                parameterGroupId: 12,
                expectedVersion: 3,
            },
        });

        expect(requestMock.put).toHaveBeenCalledWith(
            '/api/v1/groups/4/offline/flows/document',
            expect.objectContaining({
                parameterBinding: {
                    parameterGroupId: 12,
                    expectedVersion: 3,
                },
            }),
            { headers: { 'Content-Type': 'application/json' } },
        );
    });

    it('sends execution parameter overrides without groupId in the request body', async () => {
        await createOfflineDocumentDebugExecution({
            groupId: 4,
            flowPath: '_flows/jack/test/flow.yaml',
            documentHash: 'hash',
            documentUpdatedAt: 100,
            stages: [],
            edges: [],
            layout: {},
            selectedTaskIds: ['query'],
            mode: 'SELECTED',
            parameterOverrides: {
                name: '李雷',
                v_day: '20260815',
            },
        });

        expect(requestMock.post).toHaveBeenCalledWith(
            '/api/v1/groups/4/offline/executions/debug/document',
            expect.objectContaining({
                parameterOverrides: {
                    name: '李雷',
                    v_day: '20260815',
                },
            }),
            { headers: { 'Content-Type': 'application/json' } },
        );
        expect(requestMock.post.mock.calls[0][1]).not.toHaveProperty('groupId');
    });

    it('uses the group-scoped route and omits groupId from schedule status body', async () => {
        await updateOfflineScheduleStatus({
            groupId: 4,
            path: '_flows/jack/test/flow.yaml',
            enabled: true,
            contentHash: 'hash',
            fileUpdatedAt: 100,
        });

        expect(requestMock.patch).toHaveBeenCalledWith(
            '/api/v1/groups/4/offline/schedules/status',
            {
                path: '_flows/jack/test/flow.yaml',
                enabled: true,
                contentHash: 'hash',
                fileUpdatedAt: 100,
            },
            { headers: { 'Content-Type': 'application/json' } },
        );
    });
});
