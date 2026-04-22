import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import OfflineWorkbench from './OfflineWorkbench';
import { readRecoverySnapshot, removeRecoverySnapshot, writeRecoverySnapshot } from './recoverySnapshotStore';

const { authState, feedbackSpy } = vi.hoisted(() => ({
    authState: {
        userInfo: { id: 7 },
        systemAdmin: false,
        currentGroup: { id: 1, name: 'Team' },
        permissions: ['offline.write'],
    },
    feedbackSpy: vi.fn(),
}));

const authListeners = new Set<() => void>();

function setCurrentGroup(group: { id: number; name: string }) {
    authState.currentGroup = group;
    authListeners.forEach((listener) => listener());
}

vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/ui/tooltip', () => ({
    TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./FlowCanvas', () => ({
    default: ({ onNodeLayoutCommit, flowDocument }: { onNodeLayoutCommit: (nodes: Array<{ id: string; position: { x: number; y: number } }>) => void; flowDocument: { path: string } }) => (
        <div>
            <div data-testid="flow-canvas">{flowDocument.path}</div>
            <button
                type="button"
                onClick={() => onNodeLayoutCommit([{ id: 'node_1', position: { x: 120, y: 80 } }])}
            >
                make-dirty
            </button>
        </div>
    ),
}));

vi.mock('./useNodeEditorDataSources', () => ({
    useNodeEditorDataSources: () => ({
        currentDataSourceId: undefined,
        selectedDataSource: null,
        options: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        handleSearchKeywordChange: vi.fn(),
        loadMore: vi.fn(),
        setCurrentDataSourceId: vi.fn(),
    }),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({
        showFeedback: feedbackSpy,
        dismissFeedback: vi.fn(),
    }),
}));

vi.mock('../../utils/auth', async () => {
    const React = await vi.importActual<typeof import('react')>('react');
    return {
        useAuthStore: (selector: (state: typeof authState) => unknown) =>
            React.useSyncExternalStore(
                (listener) => {
                    authListeners.add(listener);
                    return () => authListeners.delete(listener);
                },
                () => selector(authState),
            ),
    };
});

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        getOfflineRepoStatus: vi.fn(),
        getOfflineRepoTree: vi.fn(),
        getOfflineRepoRemote: vi.fn(),
        getOfflineFlowDocument: vi.fn(),
        getOfflineSchedule: vi.fn(),
        saveOfflineFlowDocument: vi.fn(),
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
        branch: 'main',
        headCommitId: 'abc',
        headCommitMessage: 'init',
        headCommitAt: '2026-04-23T00:00:00Z',
    };
}

function makeRepoTree() {
    return {
        groupId: 1,
        root: {
            id: 'root',
            kind: 'ROOT' as const,
            name: '_flows',
            path: '_flows',
            children: [
                {
                    id: 'flow-1',
                    kind: 'FLOW' as const,
                    name: 'Example Flow',
                    path: '_flows/example/flow.yaml',
                    children: [],
                },
            ],
        },
    };
}

function makeFlowDocument() {
    return {
        groupId: 1,
        path: '_flows/example/flow.yaml',
        flowId: 'example',
        namespace: 'team.example',
        documentHash: 'base-hash',
        documentUpdatedAt: 100,
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes: [
                    {
                        taskId: 'node_1',
                        kind: 'SHELL' as const,
                        scriptPath: 'scripts/example/node_1.sh',
                        scriptContent: 'echo 1',
                    },
                ],
            },
        ],
        edges: [],
        layout: {
            node_1: { x: 0, y: 0 },
        },
    };
}

function makeRecoverySnapshot() {
    const document = makeFlowDocument();
    return {
        document,
        baseDocumentHash: document.documentHash,
        baseDocumentUpdatedAt: document.documentUpdatedAt,
        selectedNodeId: 'node_1',
        selectedTaskIds: ['node_1'],
        updatedAt: 123,
    };
}

describe('OfflineWorkbench save conflicts', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        setCurrentGroup({ id: 1, name: 'Team' });
        removeRecoverySnapshot(1, '_flows/example/flow.yaml');
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());
        vi.mocked(offlineApi.getOfflineRepoTree).mockResolvedValue(makeRepoTree());
        vi.mocked(offlineApi.getOfflineRepoRemote).mockResolvedValue({ hasRemote: false, remoteUrl: null });
        vi.mocked(offlineApi.getOfflineFlowDocument).mockResolvedValue(makeFlowDocument());
        vi.mocked(offlineApi.getOfflineSchedule).mockResolvedValue({
            groupId: 1,
            path: '_flows/example/flow.yaml',
            triggerId: 'trigger-1',
            cron: '',
            timezone: null,
            enabled: false,
            contentHash: 'schedule-hash',
            fileUpdatedAt: 100,
        });
    });

    it('opens the save conflict dialog instead of reloading the latest server version on a 409 save', async () => {
        const offlineApi = await import('../../api/offline');
        const conflictError = new AxiosError('Conflict');
        conflictError.response = {
            status: 409,
            statusText: 'Conflict',
            data: {},
            headers: {},
            config: { headers: {} as never },
        };
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockRejectedValue(conflictError);

        render(
            <MemoryRouter>
                <OfflineWorkbench />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();
        expect(screen.queryByText('版本提交 (Commit)')).toBeNull();
        expect(offlineApi.getOfflineFlowDocument).toHaveBeenCalledTimes(1);
        expect(feedbackSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: '保存失败' }));

        await waitFor(() => {
            expect(screen.getByTestId('flow-canvas').textContent).toBe('_flows/example/flow.yaml');
        });
    });

    it('closes the save conflict dialog when switching groups', async () => {
        const offlineApi = await import('../../api/offline');
        const conflictError = new AxiosError('Conflict');
        conflictError.response = {
            status: 409,
            statusText: 'Conflict',
            data: {},
            headers: {},
            config: { headers: {} as never },
        };
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockRejectedValue(conflictError);

        render(
            <MemoryRouter>
                <OfflineWorkbench />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();

        setCurrentGroup({ id: 2, name: 'Other Team' });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '保存冲突' })).toBeNull();
            expect(screen.queryByTestId('flow-canvas')).toBeNull();
        });
    });

    it('keeps the save conflict dialog open and preserves recovery snapshots when discard reload fails', async () => {
        const offlineApi = await import('../../api/offline');
        const conflictError = new AxiosError('Conflict');
        conflictError.response = {
            status: 409,
            statusText: 'Conflict',
            data: {},
            headers: {},
            config: { headers: {} as never },
        };
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockRejectedValue(conflictError);

        render(
            <MemoryRouter>
                <OfflineWorkbench />
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();

        writeRecoverySnapshot(1, '_flows/example/flow.yaml', makeRecoverySnapshot());
        vi.mocked(offlineApi.getOfflineFlowDocument).mockRejectedValueOnce(new Error('reload failed'));

        fireEvent.click(screen.getByRole('button', { name: '丢弃本地并加载服务器' }));

        await waitFor(() => {
            expect(screen.getByRole('dialog', { name: '保存冲突' })).toBeTruthy();
            expect(readRecoverySnapshot(1, '_flows/example/flow.yaml')).toEqual(makeRecoverySnapshot());
        });
    });
});
