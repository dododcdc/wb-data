import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineRepositoryWorkflow } from './useOfflineRepositoryWorkflow';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        getOfflineRepoStatus: vi.fn(),
        getOfflineRepoRemote: vi.fn(),
        listBranches: vi.fn(),
        pushOfflineRepo: vi.fn(),
        rebuildOfflineRepo: vi.fn(),
        switchBranch: vi.fn(),
    };
});

function makeRepoStatus() {
    return {
        groupId: 1,
        repoPath: '/repo',
        exists: true,
        gitInitialized: true,
        dirty: false,
        ahead: false,
        hasRemote: true,
        hasUpstream: true,
        branch: 'main',
        headCommitId: 'abc',
        headCommitMessage: 'init',
        headCommitAt: '2026-04-23T00:00:00Z',
    };
}

describe('useOfflineRepositoryWorkflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function renderRepositoryWorkflow(showFeedback = vi.fn()) {
        return renderHook(() => useOfflineRepositoryWorkflow({
            groupId: 1,
            canManageBranches: true,
            hasUnsavedFlowDraft: false,
            showFeedback,
        }));
    }

    it('refreshes repository status for the current group', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());

        const { result } = renderRepositoryWorkflow(showFeedback);

        await act(async () => {
            await result.current.refreshRepoStatus();
        });

        expect(offlineApi.getOfflineRepoStatus).toHaveBeenCalledWith(1);
        expect(result.current.repoStatus?.branch).toBe('main');
        expect(result.current.repoLoading).toBe(false);
        expect(showFeedback).not.toHaveBeenCalled();
    });

    it('pushes and refreshes remote and repository status on success', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.pushOfflineRepo).mockResolvedValue({
            success: true,
            message: 'pushed',
            remoteUrl: 'https://github.example/team/wb-data-1',
            remoteCreated: false,
            remoteDeleted: false,
        });
        vi.mocked(offlineApi.getOfflineRepoRemote).mockResolvedValue({ hasRemote: true, remoteUrl: 'origin-url' });
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue({ ...makeRepoStatus(), ahead: false });

        const { result } = renderRepositoryWorkflow(showFeedback);

        act(() => {
            result.current.setPushDialogOpen(true);
        });
        await act(async () => {
            await result.current.push();
        });

        expect(offlineApi.pushOfflineRepo).toHaveBeenCalledWith(1);
        expect(offlineApi.getOfflineRepoRemote).toHaveBeenCalledWith(1);
        expect(offlineApi.getOfflineRepoStatus).toHaveBeenCalledWith(1);
        expect(result.current.pushDialogOpen).toBe(false);
        expect(result.current.remoteStatus?.hasRemote).toBe(true);
        expect(showFeedback).toHaveBeenCalledWith({ tone: 'success', title: '推送成功', detail: '' });
    });

    it('allows the first push when the repo has a remote but no upstream yet', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue({
            ...makeRepoStatus(),
            hasRemote: true,
            hasUpstream: false,
            ahead: true,
        });

        const { result } = renderRepositoryWorkflow(showFeedback);

        await act(async () => {
            await result.current.refreshRepoStatus();
        });

        expect(result.current.canPush).toBe(true);
    });

    it('opens the rebuild dialog when push reports a deleted remote', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.pushOfflineRepo).mockResolvedValue({
            success: false,
            message: 'remote deleted',
            remoteUrl: null,
            remoteCreated: false,
            remoteDeleted: true,
        });

        const { result } = renderRepositoryWorkflow(showFeedback);

        act(() => {
            result.current.setPushDialogOpen(true);
        });
        await act(async () => {
            await result.current.push();
        });

        expect(result.current.pushDialogOpen).toBe(false);
        expect(result.current.rebuildDialogOpen).toBe(true);
        expect(showFeedback).not.toHaveBeenCalled();
    });

    it('rebuilds the remote and refreshes statuses on success', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.rebuildOfflineRepo).mockResolvedValue({
            success: true,
            message: 'rebuilt',
            remoteUrl: 'https://github.example/team/wb-data-1',
            remoteCreated: true,
            remoteDeleted: false,
        });
        vi.mocked(offlineApi.getOfflineRepoRemote).mockResolvedValue({ hasRemote: true, remoteUrl: 'origin-url' });
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());

        const { result } = renderRepositoryWorkflow(showFeedback);

        act(() => {
            result.current.setRebuildDialogOpen(true);
        });
        await act(async () => {
            await result.current.rebuildRemote();
        });

        expect(offlineApi.rebuildOfflineRepo).toHaveBeenCalledWith(1);
        expect(result.current.rebuildDialogOpen).toBe(false);
        expect(result.current.rebuildLoading).toBe(false);
        expect(showFeedback).toHaveBeenCalledWith({ tone: 'success', title: '推送成功', detail: '' });
    });

    it('loads branch list when the branch menu opens', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());
        vi.mocked(offlineApi.listBranches).mockResolvedValue({
            branches: [
                { name: 'main', current: true, local: true, remote: true, remoteName: 'origin/main', trackingBranch: 'origin/main' },
                { name: 'dev', current: false, local: true, remote: true, remoteName: 'origin/dev', trackingBranch: 'origin/dev' },
            ],
        });

        const { result } = renderRepositoryWorkflow(showFeedback);

        await act(async () => {
            await result.current.refreshRepoStatus();
        });
        act(() => {
            result.current.toggleBranchMenu();
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(offlineApi.listBranches).toHaveBeenCalledWith(1);
        expect(result.current.branchMenuOpen).toBe(true);
        expect(result.current.branches.map((branch) => branch.name)).toEqual(['main', 'dev']);
    });

    it('returns branch dirty state when branch switch hits a dirty working tree', async () => {
        const offlineApi = await import('../../api/offline');
        const { AxiosError } = await import('axios');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());
        vi.mocked(offlineApi.switchBranch).mockRejectedValue(new AxiosError(
            'dirty',
            undefined,
            undefined,
            undefined,
            {
                status: 409,
                statusText: 'Conflict',
                headers: {},
                config: {} as never,
                data: {
                    data: {
                        changedFlows: ['_flows/example/flow.yaml'],
                        changedFiles: ['_flows/example/flow.yaml'],
                        otherFileCount: 0,
                        changedFlowDetails: [{ path: '_flows/example/flow.yaml', status: 'MODIFIED' }],
                    },
                },
            },
        ));

        const { result } = renderRepositoryWorkflow(showFeedback);

        await act(async () => {
            await result.current.refreshRepoStatus();
        });
        await act(async () => {
            result.current.requestBranchSwitch('dev');
            await Promise.resolve();
        });

        expect(offlineApi.switchBranch).toHaveBeenCalledWith(1, 'dev');
        expect(result.current.branchDirtyState?.changedFlows).toEqual(['_flows/example/flow.yaml']);
        expect(result.current.branchMenuOpen).toBe(true);
        expect(showFeedback).toHaveBeenCalledWith(expect.objectContaining({
            tone: 'error',
            title: '工作区有未提交改动',
        }));
    });

    it('confirms draft discard before switching branches', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        const discardDraft = vi.fn();
        const afterSwitch = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());
        vi.mocked(offlineApi.switchBranch).mockResolvedValue(null);

        const { result } = renderRepositoryWorkflow(showFeedback);

        await act(async () => {
            await result.current.refreshRepoStatus();
        });
        act(() => {
            result.current.requestBranchSwitch('dev', {
                hasUnsavedDraft: true,
                discardDraft,
                afterSwitch,
            });
        });

        expect(result.current.discardBranchSwitchOpen).toBe(true);
        expect(offlineApi.switchBranch).not.toHaveBeenCalled();

        await act(async () => {
            result.current.confirmDiscardDraftAndSwitchBranch();
            await Promise.resolve();
        });

        expect(discardDraft).toHaveBeenCalled();
        expect(offlineApi.switchBranch).toHaveBeenCalledWith(1, 'dev');
        expect(afterSwitch).toHaveBeenCalledWith('dev');
        expect(result.current.discardBranchSwitchOpen).toBe(false);
    });
});
