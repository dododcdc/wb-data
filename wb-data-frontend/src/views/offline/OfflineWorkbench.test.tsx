import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import OfflineWorkbench from './OfflineWorkbench';
import { useAuthStore } from '../../utils/auth';

const offlineApiMocks = vi.hoisted(() => ({
    getOfflineRepoStatus: vi.fn(),
    getOfflineRepoTree: vi.fn(),
    getOfflineRepoRemote: vi.fn(),
}));

vi.mock('../../api/offline', () => ({
    getOfflineRepoStatus: offlineApiMocks.getOfflineRepoStatus,
    getOfflineRepoTree: offlineApiMocks.getOfflineRepoTree,
    getOfflineRepoRemote: offlineApiMocks.getOfflineRepoRemote,
    createOfflineFolder: vi.fn(),
    createOfflineSavedDebugExecution: vi.fn(),
    getOfflineExecution: vi.fn(),
    getOfflineExecutionLogs: vi.fn(),
    getOfflineFlowContent: vi.fn(),
    getOfflineFlowDocument: vi.fn(),
    getOfflineSchedule: vi.fn(),
    listOfflineExecutions: vi.fn(),
    pushOfflineRepo: vi.fn(),
    saveOfflineFlowDocument: vi.fn(),
    stopAllOfflineExecutions: vi.fn(),
    stopOfflineExecution: vi.fn(),
    updateOfflineSchedule: vi.fn(),
    updateOfflineScheduleStatus: vi.fn(),
}));

vi.mock('./FlowCanvas', () => ({
    default: () => <div data-testid="flow-canvas" />,
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({
        showFeedback: vi.fn(),
        dismissFeedback: vi.fn(),
    }),
}));

describe('OfflineWorkbench', () => {
    beforeEach(() => {
        useAuthStore.setState({
            token: 'token',
            userInfo: null,
            systemAdmin: false,
            currentGroup: {
                id: 7,
                name: '离线开发组',
                description: '',
                role: 'GROUP_ADMIN',
            },
            accessibleGroups: [],
            permissions: ['offline.write'],
            contextLoaded: true,
        });

        offlineApiMocks.getOfflineRepoStatus.mockResolvedValue({
            groupId: 7,
            repoPath: '/tmp/repo',
            exists: true,
            gitInitialized: true,
            dirty: false,
            branch: 'main',
            headCommitId: null,
            headCommitMessage: null,
            headCommitAt: null,
        });
        offlineApiMocks.getOfflineRepoRemote.mockResolvedValue({
            hasRemote: false,
            remoteUrl: null,
        });
        offlineApiMocks.getOfflineRepoTree.mockResolvedValue({
            groupId: 7,
            root: {
                id: 'group-7',
                kind: 'ROOT',
                name: '离线开发组',
                path: '',
                children: [
                    {
                        id: '_flows/demo',
                        kind: 'DIRECTORY',
                        name: 'demo',
                        path: '_flows/demo',
                        children: [],
                    },
                ],
            },
        });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        useAuthStore.getState().clearAuth();
    });

    it('shows both flow and folder creation actions in the tree toolbar for writable users', async () => {
        render(<OfflineWorkbench />);

        await waitFor(() => {
            expect(offlineApiMocks.getOfflineRepoTree).toHaveBeenCalledWith(7);
        });

        expect(screen.getByLabelText('新建 Flow')).toBeInTheDocument();
        expect(screen.getByLabelText('新建文件夹')).toBeInTheDocument();
    });
});
