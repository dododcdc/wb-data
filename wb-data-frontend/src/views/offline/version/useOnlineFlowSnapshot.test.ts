import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGitSyncConfigs, type GitSyncConfig } from '../../../api/gitSettings';
import { getOfflineFlowSnapshot, type OfflineFlowVersionSnapshot } from '../../../api/offline';
import { useOnlineFlowSnapshot } from './useOnlineFlowSnapshot';

vi.mock('../../../api/gitSettings', () => ({
    getGitSyncConfigs: vi.fn(),
}));

vi.mock('../../../api/offline', () => ({
    getOfflineFlowSnapshot: vi.fn(),
}));

function makeSyncConfig(overrides: Partial<GitSyncConfig> = {}): GitSyncConfig {
    return {
        id: 1,
        groupId: 10,
        branch: 'main',
        namespace: 'pg-10',
        syncFlowId: 'git-sync-main',
        enabled: true,
        lastSyncAt: '2026-11-14T10:00:00Z',
        lastSyncStatus: 'SUCCESS',
        lastSyncMessage: null,
        lastDeployedSha: 'a'.repeat(40),
        lastDeployedAt: '2026-11-14T10:00:00Z',
        deploymentEvidence: 'CONFIRMED',
        ...overrides,
    };
}

function makeSnapshot(rev = 'a'.repeat(40), flowPath = '_flows/demo/flow.yaml'): OfflineFlowVersionSnapshot {
    return {
        revision: rev,
        files: [],
        nodeMetadata: {},
        document: {
            groupId: 10,
            path: flowPath,
            flowId: 'demo',
            namespace: 'pg-10',
            documentHash: 'hash',
            documentUpdatedAt: 1,
            stages: [{ stageId: 'stage-1', parallel: false, nodes: [] }],
            edges: [],
            layout: {},
            schedule: {
                period: 'DAILY',
                cron: '0 2 * * *',
                timezone: 'Asia/Shanghai',
                enabled: true,
            },
            runtimeTimezone: 'Asia/Shanghai',
            parameterBinding: null,
            dependencyConfig: {
                dependencies: [],
                failurePolicy: 'CONTINUE',
                crossGroupDependency: 'ALLOW',
            },
        },
    };
}

describe('useOnlineFlowSnapshot', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('strictly reports unconfirmed and skips fetching snapshot when deploymentEvidence is UNKNOWN or UNCONFIRMED', async () => {
        vi.mocked(getGitSyncConfigs).mockResolvedValue({
            configs: [makeSyncConfig({ deploymentEvidence: 'UNKNOWN', lastDeployedSha: 'b'.repeat(40) })],
            availableBranches: ['main'],
            syncCron: '*/5 * * * *',
        });

        const { result } = renderHook(() => useOnlineFlowSnapshot({
            groupId: 10,
            branch: 'main',
            activeFlowPath: '_flows/demo/flow.yaml',
            enabled: true,
        }));

        await waitFor(() => {
            expect(result.current.status).toBe('unconfirmed');
        });
        expect(result.current.confirmedRevision).toBeNull();
        expect(result.current.onlineDocument).toBeNull();
        expect(getOfflineFlowSnapshot).not.toHaveBeenCalled();
    });

    it('loads confirmed online snapshot only when enabled and reuses cached snapshot across mode switches', async () => {
        const rev = 'c'.repeat(40);
        const snapshot = makeSnapshot(rev);
        vi.mocked(getGitSyncConfigs).mockResolvedValue({
            configs: [makeSyncConfig({ lastDeployedSha: rev, deploymentEvidence: 'CONFIRMED' })],
            availableBranches: ['main'],
            syncCron: '*/5 * * * *',
        });
        vi.mocked(getOfflineFlowSnapshot).mockResolvedValue(snapshot);

        const { result, rerender } = renderHook(
            ({ enabled, path }: { enabled: boolean; path: string | null }) => useOnlineFlowSnapshot({
                groupId: 10,
                branch: 'main',
                activeFlowPath: path,
                enabled,
            }),
            { initialProps: { enabled: false, path: '_flows/demo/flow.yaml' } },
        );

        await waitFor(() => {
            expect(result.current.confirmedRevision).toBe(rev);
        });
        expect(getOfflineFlowSnapshot).not.toHaveBeenCalled();

        rerender({ enabled: true, path: '_flows/demo/flow.yaml' });
        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(result.current.onlineDocument).toEqual(snapshot.document);
        expect(getOfflineFlowSnapshot).toHaveBeenCalledTimes(1);
        expect(getOfflineFlowSnapshot).toHaveBeenCalledWith(10, '_flows/demo/flow.yaml', rev);

        // Switching back to dev mode and returning on the same revision reuses snapshot cleanly
        rerender({ enabled: false, path: '_flows/demo/flow.yaml' });
        rerender({ enabled: true, path: '_flows/demo/flow.yaml' });
        expect(result.current.status).toBe('ready');
        expect(getOfflineFlowSnapshot).toHaveBeenCalledTimes(1);

        // Switching flow path invalidates old snapshot immediately and loads the new flow
        const otherSnapshot = makeSnapshot(rev, '_flows/other/flow.yaml');
        vi.mocked(getOfflineFlowSnapshot).mockResolvedValueOnce(otherSnapshot);
        rerender({ enabled: true, path: '_flows/other/flow.yaml' });
        await waitFor(() => {
            expect(result.current.onlineDocument?.path).toBe('_flows/other/flow.yaml');
        });
        expect(getOfflineFlowSnapshot).toHaveBeenCalledTimes(2);
    });

    it('reports not-in-revision when snapshot endpoint returns 404', async () => {
        const rev = 'd'.repeat(40);
        vi.mocked(getGitSyncConfigs).mockResolvedValue({
            configs: [makeSyncConfig({ lastDeployedSha: rev, deploymentEvidence: 'CONFIRMED' })],
            availableBranches: ['main'],
            syncCron: '*/5 * * * *',
        });
        vi.mocked(getOfflineFlowSnapshot).mockRejectedValue(
            new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
                status: 404,
                statusText: 'Not Found',
                headers: new AxiosHeaders(),
                config: { headers: new AxiosHeaders() },
                data: { message: '任务文件不存在' },
            }),
        );

        const { result } = renderHook(() => useOnlineFlowSnapshot({
            groupId: 10,
            branch: 'main',
            activeFlowPath: '_flows/new_flow/flow.yaml',
            enabled: true,
        }));

        await waitFor(() => {
            expect(result.current.status).toBe('not-in-revision');
        });
        expect(result.current.onlineDocument).toBeNull();
    });

    it('re-fetches deployment config and snapshot when refresh is called', async () => {
        const rev1 = '1'.repeat(40);
        const rev2 = '2'.repeat(40);
        vi.mocked(getGitSyncConfigs)
            .mockResolvedValueOnce({
                configs: [makeSyncConfig({ lastDeployedSha: rev1, deploymentEvidence: 'CONFIRMED' })],
                availableBranches: ['main'],
                syncCron: '*/5 * * * *',
            })
            .mockResolvedValueOnce({
                configs: [makeSyncConfig({ lastDeployedSha: rev2, deploymentEvidence: 'CONFIRMED' })],
                availableBranches: ['main'],
                syncCron: '*/5 * * * *',
            });
        vi.mocked(getOfflineFlowSnapshot)
            .mockResolvedValueOnce(makeSnapshot(rev1))
            .mockResolvedValueOnce(makeSnapshot(rev2));

        const { result } = renderHook(() => useOnlineFlowSnapshot({
            groupId: 10,
            branch: 'main',
            activeFlowPath: '_flows/demo/flow.yaml',
            enabled: true,
        }));

        await waitFor(() => {
            expect(result.current.snapshot?.revision).toBe(rev1);
        });

        await act(async () => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(result.current.snapshot?.revision).toBe(rev2);
        });
    });
});
