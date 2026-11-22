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
    createBranch,
    createOfflineDocumentDebugExecution,
    getOfflineRepoStatus,
    listBranches,
    mergeBranch,
    pushOfflineCurrentFlow,
    pushOfflineRepo,
    rebuildOfflineRepo,
    saveOfflineFlowDocument,
    switchBranch,
    testGitHubConnection,
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

    it('configures extended timeouts for remote Git operations', async () => {
        await pushOfflineRepo(4);
        await pushOfflineCurrentFlow(4, '_flows/demo/flow.yaml');
        await rebuildOfflineRepo(4);
        await testGitHubConnection(4, 'github', 'user', 'tok', 'https://github.com', 'owner');
        await listBranches(4);
        await createBranch(4, 'feature/test', 'main');
        await switchBranch(4, 'feature/test');
        await mergeBranch(4, 'feature/test', 'main');

        expect(requestMock.post).toHaveBeenNthCalledWith(
            1,
            '/api/v1/groups/4/offline/repo/push',
            {},
            {
                timeout: 90_000,
                headers: { 'Content-Type': 'application/json' },
            },
        );
        expect(requestMock.post).toHaveBeenNthCalledWith(
            2,
            '/api/v1/groups/4/offline/repo/push/flow',
            { flowPath: '_flows/demo/flow.yaml' },
            {
                timeout: 90_000,
                headers: { 'Content-Type': 'application/json' },
            },
        );
        expect(requestMock.post).toHaveBeenNthCalledWith(
            3,
            '/api/v1/groups/4/offline/repo/push/rebuild',
            {},
            {
                timeout: 90_000,
                headers: { 'Content-Type': 'application/json' },
            },
        );
        expect(requestMock.post).toHaveBeenNthCalledWith(
            4,
            '/api/v1/groups/4/git/config/test',
            {
                provider: 'github',
                username: 'user',
                token: 'tok',
                baseUrl: 'https://github.com',
                owner: 'owner',
            },
            {
                timeout: 90_000,
                headers: { 'Content-Type': 'application/json' },
            },
        );
        expect(requestMock.get).toHaveBeenCalledWith(
            '/api/v1/groups/4/offline/repo/branches',
            { timeout: 90_000 },
        );
        expect(requestMock.post).toHaveBeenNthCalledWith(
            5,
            '/api/v1/groups/4/offline/repo/branch',
            { name: 'feature/test', baseBranch: 'main' },
            {
                timeout: 90_000,
                headers: { 'Content-Type': 'application/json' },
            },
        );
        expect(requestMock.put).toHaveBeenCalledWith(
            '/api/v1/groups/4/offline/repo/branch/switch',
            { branch: 'feature/test' },
            {
                timeout: 90_000,
                headers: { 'Content-Type': 'application/json' },
            },
        );
        expect(requestMock.post).toHaveBeenNthCalledWith(
            6,
            '/api/v1/groups/4/offline/repo/branch/merge',
            { source: 'feature/test', target: 'main' },
            {
                timeout: 90_000,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    });
});
