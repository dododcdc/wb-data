import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSelectedOfflineBranch, getSelectedOfflineBranch } from '../../../utils/offlineBranchStore';
import { useOfflineRepositoryWorkflow } from './useOfflineRepositoryWorkflow';

vi.mock('../../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../../api/offline')>('../../../api/offline');
    return {
        ...actual,
        commitOfflineRepo: vi.fn(),
        createBranch: vi.fn(),
        getOfflineRepoStatus: vi.fn(),
        getOfflineRepoRemote: vi.fn(),
        listBranches: vi.fn(),
        pushOfflineRepo: vi.fn(),
        rebuildOfflineRepo: vi.fn(),
        switchBranch: vi.fn(),
        syncBranchFromMain: vi.fn(),
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
        clearSelectedOfflineBranch(1);
    });

    afterEach(() => {
        clearSelectedOfflineBranch(1);
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
        const offlineApi = await import('../../../api/offline');
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
        const offlineApi = await import('../../../api/offline');
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
        const offlineApi = await import('../../../api/offline');
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

    it('saves the current Flow before committing the repository when requested', async () => {
        const offlineApi = await import('../../../api/offline');
        const showFeedback = vi.fn();
        const saveCurrentFlowBeforeCommit = vi.fn().mockResolvedValue(true);
        const afterCommit = vi.fn().mockResolvedValue(undefined);
        vi.mocked(offlineApi.commitOfflineRepo).mockResolvedValue({ success: true, message: 'repo committed' });
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());

        const { result } = renderRepositoryWorkflow(showFeedback);

        await act(async () => {
            const committed = await result.current.commitRepo('repo commit', {
                saveCurrentFlowBeforeCommit,
                afterCommit,
            });
            expect(committed).toBe(true);
        });

        expect(saveCurrentFlowBeforeCommit).toHaveBeenCalled();
        expect(offlineApi.commitOfflineRepo).toHaveBeenCalledWith(1, 'repo commit');
        expect(afterCommit).toHaveBeenCalled();
        expect(offlineApi.getOfflineRepoStatus).toHaveBeenCalledWith(1);
        expect(showFeedback).toHaveBeenCalledWith({ tone: 'success', title: 'repo committed', detail: '' });
    });

    it('opens the rebuild dialog when push reports a deleted remote', async () => {
        const offlineApi = await import('../../../api/offline');
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
        const offlineApi = await import('../../../api/offline');
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
        const offlineApi = await import('../../../api/offline');
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
        const offlineApi = await import('../../../api/offline');
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
        expect(result.current.branchDirtyState?.targetBranch).toBe('dev');
        expect(result.current.branchDirtyDialogOpen).toBe(true);
        expect(result.current.branchMenuOpen).toBe(false);
        expect(showFeedback).not.toHaveBeenCalled();
    });

    it('confirms draft discard before switching branches', async () => {
        const offlineApi = await import('../../../api/offline');
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
        expect(getSelectedOfflineBranch(1)).toBe('dev');
        expect(afterSwitch).toHaveBeenCalledWith('dev');
        expect(result.current.discardBranchSwitchOpen).toBe(false);
    });

    it('creates a new branch, persists selection and switches to it', async () => {
        const offlineApi = await import('../../../api/offline');
        const showFeedback = vi.fn();
        const afterSwitch = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());
        vi.mocked(offlineApi.createBranch).mockResolvedValue(null);

        const { result } = renderRepositoryWorkflow(showFeedback);
        await act(async () => {
            await result.current.refreshRepoStatus();
        });

        let created = false;
        await act(async () => {
            created = await result.current.createBranchAndSwitch('feature/a', 'main', { afterSwitch });
        });

        expect(created).toBe(true);
        expect(offlineApi.createBranch).toHaveBeenCalledWith(1, 'feature/a', 'main');
        expect(getSelectedOfflineBranch(1)).toBe('feature/a');
        expect(afterSwitch).toHaveBeenCalledWith('feature/a');
        expect(showFeedback).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success', title: '分支已创建并切换' }));
    });

    it('syncs active feature branch from main and opens dirty dialog on 409 dirty error', async () => {
        const { AxiosError } = await import('axios');
        const offlineApi = await import('../../../api/offline');
        const showFeedback = vi.fn();
        const afterSync = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue({
            ...makeRepoStatus(),
            branch: 'feature/a',
        });
        vi.mocked(offlineApi.syncBranchFromMain).mockResolvedValueOnce({
            sourceBranch: 'main',
            targetBranch: 'feature/a',
            upToDate: false,
            headCommitId: 'def456',
            message: '已同步 main 最新改动',
        });

        const { result } = renderRepositoryWorkflow(showFeedback);
        await act(async () => {
            await result.current.refreshRepoStatus();
        });

        await act(async () => {
            await result.current.syncFromMain({ afterSync });
        });

        expect(offlineApi.syncBranchFromMain).toHaveBeenCalledWith(1, 'feature/a');
        expect(afterSync).toHaveBeenCalled();
        expect(showFeedback).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success', title: '已同步 main 最新改动' }));

        vi.mocked(offlineApi.syncBranchFromMain).mockRejectedValueOnce(new AxiosError(
            'Conflict',
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

        await act(async () => {
            await result.current.syncFromMain({ afterSync });
        });

        expect(result.current.branchDirtyDialogOpen).toBe(true);
        expect(result.current.branchDirtyState?.action).toBe('sync-main');
    });
});
