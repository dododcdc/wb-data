import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineRepositoryWorkflow } from './useOfflineRepositoryWorkflow';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        getOfflineRepoStatus: vi.fn(),
        getOfflineRepoRemote: vi.fn(),
        pushOfflineRepo: vi.fn(),
        rebuildOfflineRepo: vi.fn(),
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

    it('refreshes repository status for the current group', async () => {
        const offlineApi = await import('../../api/offline');
        const showFeedback = vi.fn();
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());

        const { result } = renderHook(() => useOfflineRepositoryWorkflow({ groupId: 1, showFeedback }));

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

        const { result } = renderHook(() => useOfflineRepositoryWorkflow({ groupId: 1, showFeedback }));

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

        const { result } = renderHook(() => useOfflineRepositoryWorkflow({ groupId: 1, showFeedback }));

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

        const { result } = renderHook(() => useOfflineRepositoryWorkflow({ groupId: 1, showFeedback }));

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
});
