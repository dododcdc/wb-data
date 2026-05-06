import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import OfflineWorkbench from './OfflineWorkbench';
import { removeRecoverySnapshot } from './recoverySnapshotStore';

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
const authStoreListeners = new Set<(state: typeof authState, previousState: typeof authState) => void>();

function setCurrentGroup(group: { id: number; name: string }) {
    const previousState = {
        ...authState,
        currentGroup: authState.currentGroup ? { ...authState.currentGroup } : authState.currentGroup,
    };
    authState.currentGroup = group;
    authStoreListeners.forEach((listener) => listener(authState, previousState));
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
    default: ({ flowDocument }: { flowDocument: { path: string } }) => (
        <div data-testid="flow-canvas">{flowDocument.path}</div>
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
    const useAuthStore = Object.assign(
        (selector: (state: typeof authState) => unknown) =>
            React.useSyncExternalStore(
                (listener) => {
                    authListeners.add(listener);
                    return () => authListeners.delete(listener);
                },
                () => selector(authState),
            ),
        {
            subscribe: (listener: (state: typeof authState, previousState: typeof authState) => void) => {
                authStoreListeners.add(listener);
                return () => authStoreListeners.delete(listener);
            },
            getState: () => authState,
        },
    );
    return {
        useAuthStore,
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
        deleteOfflineFlow: vi.fn(),
        deleteOfflineFolder: vi.fn(),
        listOfflineExecutions: vi.fn(),
        getOfflineExecution: vi.fn(),
        getOfflineFlowCommitStatus: vi.fn(),
        commitOfflineCurrentFlow: vi.fn(),
        commitOfflineRepo: vi.fn(),
        pushOfflineRepo: vi.fn(),
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

function makeRepoTree(options?: { includeFolder?: boolean }) {
    const children: Array<{
        id: string;
        kind: 'FLOW' | 'DIRECTORY';
        name: string;
        path: string;
        children: Array<never>;
    }> = [
        {
            id: 'flow-1',
            kind: 'FLOW',
            name: 'Example Flow',
            path: '_flows/example/flow.yaml',
            children: [],
        },
    ];
    if (options?.includeFolder) {
        children.push({
            id: 'folder-1',
            kind: 'DIRECTORY',
            name: 'Sub Folder',
            path: '_flows/sub',
            children: [],
        });
    }
    return {
        groupId: 1,
        root: {
            id: 'root',
            kind: 'ROOT' as const,
            name: '_flows',
            path: '_flows',
            children,
        },
    };
}

function makeFlowDocument() {
    return {
        ...makeFlowDocumentBase(),
        documentHash: 'base-hash',
        documentUpdatedAt: 100,
    };
}

function makeFlowDocumentBase() {
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

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createApiDeferred<TResponse>() {
    return createDeferred<TResponse>();
}

function makeDeleteResponse() {
    return {
        data: undefined,
        status: 204,
        statusText: 'No Content',
        headers: AxiosHeaders.from({}),
        config: {
            headers: AxiosHeaders.from({}),
        },
    };
}

function renderOfflineWorkbench() {
    const router = createMemoryRouter(
        [
            {
                path: '/offline',
                element: <OfflineWorkbench />,
            },
        ],
        {
            initialEntries: ['/offline'],
        },
    );
    return render(<RouterProvider router={router} />);
}

async function openFlowDeleteDialog() {
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Example Flow' }), {
        clientX: 120,
        clientY: 80,
    });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    return screen.findByRole('dialog', { name: '确认删除 Flow' });
}

async function openFolderDeleteDialog() {
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Sub Folder' }), {
        clientX: 120,
        clientY: 80,
    });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    return screen.findByRole('dialog', { name: '确认删除文件夹' });
}

describe('OfflineWorkbench commit UI', () => {
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
        vi.mocked(offlineApi.getOfflineFlowCommitStatus).mockResolvedValue({ groupId: 1, flowPath: '_flows/example/flow.yaml', dirty: true });
    });

    it('hides repo commit and push from developers', async () => {
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        expect(screen.getByRole('button', { name: '提交当前 Flow' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '提交仓库改动' })).toBeNull();
        expect(screen.queryByRole('button', { name: '推送' })).toBeNull();
    });

    it('shows repo commit and push for group admins', async () => {
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];

        renderOfflineWorkbench();

        expect(screen.getByRole('button', { name: '提交仓库改动' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '推送' })).toBeTruthy();
    });

    it('routes current-flow commit through the Flow-scoped API', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.getOfflineFlowCommitStatus).mockResolvedValue({ groupId: 1, flowPath: '_flows/example/flow.yaml', dirty: true });
        vi.mocked(offlineApi.commitOfflineCurrentFlow).mockResolvedValue({ success: true, message: 'ok' });

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: '提交当前 Flow' }));
        fireEvent.change(await screen.findByPlaceholderText('例如：Update query conditions'), { target: { value: 'flow commit' } });
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        await waitFor(() => {
            expect(offlineApi.commitOfflineCurrentFlow).toHaveBeenCalledWith(1, '_flows/example/flow.yaml', 'flow commit');
        });
    });

    it('routes repo commit through the repo-scoped API', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.commitOfflineRepo).mockResolvedValue({ success: true, message: 'ok' });

        renderOfflineWorkbench();

        // Select a flow first so the component is in a loaded state
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        // Now click repo commit
        fireEvent.click(screen.getByRole('button', { name: '提交仓库改动' }));
        const input = await screen.findByPlaceholderText('例如：Update query conditions');
        fireEvent.change(input, { target: { value: 'repo commit' } });
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        await waitFor(() => {
            expect(offlineApi.commitOfflineRepo).toHaveBeenCalledWith(1, 'repo commit');
        });
    });
});

describe('OfflineWorkbench destructive confirmations', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        setCurrentGroup({ id: 1, name: 'Team' });
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());
        vi.mocked(offlineApi.getOfflineRepoTree).mockResolvedValue(makeRepoTree({ includeFolder: true }));
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
        vi.mocked(offlineApi.getOfflineFlowCommitStatus).mockResolvedValue({ groupId: 1, flowPath: '_flows/example/flow.yaml', dirty: true });
    });

    afterEach(() => {
        cleanup();
    });

    it('keeps the flow delete dialog open while the request is pending and closes it after success', async () => {
        const offlineApi = await import('../../api/offline');
        const deleteDeferred = createApiDeferred<Awaited<ReturnType<typeof offlineApi.deleteOfflineFlow>>>();
        vi.mocked(offlineApi.deleteOfflineFlow).mockReturnValueOnce(deleteDeferred.promise);

        renderOfflineWorkbench();

        const dialog = await openFlowDeleteDialog();
        expect(screen.getByRole('heading', { name: '确认删除 Flow' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '删除' }));

        await waitFor(() => {
            expect((screen.getByRole('button', { name: '处理中...' }) as HTMLButtonElement).disabled).toBe(true);
            expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
        });

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: '确认删除 Flow' })).toBeTruthy();

        await act(async () => {
            deleteDeferred.resolve(makeDeleteResponse());
            await deleteDeferred.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '确认删除 Flow' })).toBeNull();
        });
    });

    it('keeps the folder delete dialog open after failure, blocks dismissal while retrying, and closes it after success', async () => {
        const offlineApi = await import('../../api/offline');
        const firstAttempt = createApiDeferred<Awaited<ReturnType<typeof offlineApi.deleteOfflineFolder>>>();
        const retryDeferred = createApiDeferred<Awaited<ReturnType<typeof offlineApi.deleteOfflineFolder>>>();
        vi.mocked(offlineApi.deleteOfflineFolder)
            .mockReturnValueOnce(firstAttempt.promise)
            .mockReturnValueOnce(retryDeferred.promise);

        renderOfflineWorkbench();

        await openFolderDeleteDialog();
        expect(screen.getByRole('heading', { name: '确认删除文件夹' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '删除' }));

        await act(async () => {
            firstAttempt.reject(new Error('delete failed'));
            try {
                await firstAttempt.promise;
            } catch {
                // ignore
            }
        });

        await waitFor(() => {
            const dlg = screen.getByRole('dialog', { name: '确认删除文件夹' });
            const btn = within(dlg).getByRole('button', { name: '删除' }) as HTMLButtonElement;
            if (btn.disabled) throw new Error('confirm button still disabled');
        });

        expect(screen.getByRole('dialog', { name: '确认删除文件夹' })).toBeTruthy();

        fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除文件夹' })).getByRole('button', { name: '删除' }));

        await waitFor(() => {
            expect((within(screen.getByRole('dialog', { name: '确认删除文件夹' })).getByRole('button', { name: '处理中...' }) as HTMLButtonElement).disabled).toBe(true);
        });

        await act(async () => {
            retryDeferred.resolve(makeDeleteResponse());
            await retryDeferred.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '确认删除文件夹' })).toBeNull();
        });
    });
});