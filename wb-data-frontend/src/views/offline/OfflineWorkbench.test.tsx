import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

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
        children.unshift({
            id: 'folder-1',
            kind: 'DIRECTORY',
            name: 'Drafts',
            path: '_flows/drafts',
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

function makeFlowDocument(overrides?: Partial<ReturnType<typeof makeFlowDocumentBase>>) {
    return {
        ...makeFlowDocumentBase(),
        ...overrides,
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

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
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
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Drafts' }), {
        clientX: 120,
        clientY: 80,
    });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    return screen.findByRole('dialog', { name: '确认删除文件夹' });
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

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        expect(readRecoverySnapshot(1, '_flows/example/flow.yaml')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();
        await waitFor(() => {
            expect(readRecoverySnapshot(1, '_flows/example/flow.yaml')).toEqual(expect.objectContaining({
                baseDocumentHash: 'base-hash',
                baseDocumentUpdatedAt: 100,
                selectedNodeId: null,
                selectedTaskIds: [],
                updatedAt: expect.any(Number),
                document: expect.objectContaining({
                    path: '_flows/example/flow.yaml',
                    documentHash: 'base-hash',
                    documentUpdatedAt: 100,
                    layout: {
                        node_1: { x: 120, y: 80 },
                    },
                }),
            }));
        });
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

        renderOfflineWorkbench();

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

    it('ignores an in-flight overwrite action after switching groups', async () => {
        const offlineApi = await import('../../api/offline');
        const conflictError = new AxiosError('Conflict');
        conflictError.response = {
            status: 409,
            statusText: 'Conflict',
            data: {},
            headers: {},
            config: { headers: {} as never },
        };
        const latestDocument = createDeferred<ReturnType<typeof makeFlowDocument>>();
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockRejectedValue(conflictError);

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();

        vi.mocked(offlineApi.getOfflineFlowDocument).mockReturnValueOnce(latestDocument.promise);
        fireEvent.click(screen.getByRole('button', { name: '用我的覆盖' }));
        fireEvent.click(screen.getByRole('button', { name: '确认覆盖保存' }));

        await waitFor(() => {
            expect(offlineApi.getOfflineFlowDocument).toHaveBeenCalledTimes(2);
        });

        await act(async () => {
            setCurrentGroup({ id: 2, name: 'Other Team' });
            latestDocument.resolve(makeFlowDocument());
            await latestDocument.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '保存冲突' })).toBeNull();
        });

        expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalledTimes(1);
        expect(feedbackSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Flow 已保存' }));
        expect(feedbackSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: '覆盖保存失败' }));
    });

    it('ignores an in-flight discard action after switching groups', async () => {
        const offlineApi = await import('../../api/offline');
        const conflictError = new AxiosError('Conflict');
        conflictError.response = {
            status: 409,
            statusText: 'Conflict',
            data: {},
            headers: {},
            config: { headers: {} as never },
        };
        const reloadedDocument = createDeferred<ReturnType<typeof makeFlowDocument>>();
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockRejectedValue(conflictError);

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();

        vi.mocked(offlineApi.getOfflineFlowDocument).mockReturnValueOnce(reloadedDocument.promise);
        fireEvent.click(screen.getByRole('button', { name: '丢弃本地并加载服务器' }));

        await waitFor(() => {
            expect(offlineApi.getOfflineFlowDocument).toHaveBeenCalledTimes(2);
        });

        await act(async () => {
            setCurrentGroup({ id: 2, name: 'Other Team' });
            reloadedDocument.resolve(makeFlowDocument());
            await reloadedDocument.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '保存冲突' })).toBeNull();
            expect(screen.queryByTestId('flow-canvas')).toBeNull();
        });

        expect(offlineApi.getOfflineSchedule).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('flow-canvas')).toBeNull();
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

        renderOfflineWorkbench();

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

    it('treats discard reload as complete once the server flow is applied, even if a follow-up schedule error handler throws', async () => {
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
        vi.mocked(offlineApi.getOfflineSchedule).mockRejectedValueOnce(new Error('schedule failed'));
        feedbackSpy.mockImplementationOnce(() => {
            throw new Error('feedback unavailable');
        });

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();

        writeRecoverySnapshot(1, '_flows/example/flow.yaml', makeRecoverySnapshot());

        fireEvent.click(screen.getByRole('button', { name: '丢弃本地并加载服务器' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '保存冲突' })).toBeNull();
            expect(readRecoverySnapshot(1, '_flows/example/flow.yaml')).toBeNull();
            expect(screen.getByTestId('flow-canvas').textContent).toBe('_flows/example/flow.yaml');
        });
    });

    it('refreshes the persisted recovery snapshot after rebasing for an overwrite retry that still fails', async () => {
        const offlineApi = await import('../../api/offline');
        const conflictError = new AxiosError('Conflict');
        conflictError.response = {
            status: 409,
            statusText: 'Conflict',
            data: {},
            headers: {},
            config: { headers: {} as never },
        };
        const overwriteError = new Error('write failed');
        vi.mocked(offlineApi.saveOfflineFlowDocument)
            .mockRejectedValueOnce(conflictError)
            .mockRejectedValueOnce(overwriteError);
        vi.mocked(offlineApi.getOfflineFlowDocument).mockResolvedValueOnce(makeFlowDocument()).mockResolvedValueOnce(makeFlowDocument({
            documentHash: 'server-hash',
            documentUpdatedAt: 200,
        }));

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();
        expect(readRecoverySnapshot(1, '_flows/example/flow.yaml')).toEqual(expect.objectContaining({
            baseDocumentHash: 'base-hash',
            baseDocumentUpdatedAt: 100,
        }));

        fireEvent.click(screen.getByRole('button', { name: '用我的覆盖' }));
        fireEvent.click(screen.getByRole('button', { name: '确认覆盖保存' }));

        await waitFor(() => {
            expect(screen.getByRole('dialog', { name: '保存冲突' })).toBeTruthy();
            expect(readRecoverySnapshot(1, '_flows/example/flow.yaml')).toEqual(expect.objectContaining({
                baseDocumentHash: 'server-hash',
                baseDocumentUpdatedAt: 200,
                document: expect.objectContaining({
                    layout: {
                        node_1: { x: 120, y: 80 },
                    },
                }),
            }));
        });
        expect(feedbackSpy).toHaveBeenCalledWith(expect.objectContaining({ title: '覆盖保存失败' }));
    });

    it('disables save conflict actions while discard reload is in flight', async () => {
        const offlineApi = await import('../../api/offline');
        const conflictError = new AxiosError('Conflict');
        conflictError.response = {
            status: 409,
            statusText: 'Conflict',
            data: {},
            headers: {},
            config: { headers: {} as never },
        };
        const reloadedDocument = createDeferred<ReturnType<typeof makeFlowDocument>>();
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockRejectedValue(conflictError);

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        expect(await screen.findByRole('dialog', { name: '保存冲突' })).toBeTruthy();

        vi.mocked(offlineApi.getOfflineFlowDocument).mockReturnValueOnce(reloadedDocument.promise);
        fireEvent.click(screen.getByRole('button', { name: '丢弃本地并加载服务器' }));

        await waitFor(() => {
            expect((screen.getByRole('button', { name: '丢弃本地并加载服务器' }) as HTMLButtonElement).disabled).toBe(true);
            expect((screen.getByRole('button', { name: '用我的覆盖' }) as HTMLButtonElement).disabled).toBe(true);
            expect((screen.getByRole('button', { name: '稍后处理' }) as HTMLButtonElement).disabled).toBe(true);
            expect((screen.getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(true);
        });

        await act(async () => {
            reloadedDocument.resolve(makeFlowDocument());
            await reloadedDocument.promise;
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
    });

    afterEach(() => {
        cleanup();
    });

    it('keeps the flow delete dialog open while the request is pending and closes it after success', async () => {
        const offlineApi = await import('../../api/offline');
        const deleteDeferred = createDeferred<void>();
        vi.mocked(offlineApi.deleteOfflineFlow).mockReturnValueOnce(deleteDeferred.promise);

        renderOfflineWorkbench();

        const dialog = await openFlowDeleteDialog();
        expect(screen.getByRole('heading', { name: '确认删除 Flow' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '删除' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '处理中...' })).toHaveAttribute('disabled');
            expect(screen.getByRole('button', { name: '取消' })).toHaveAttribute('disabled');
        });

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: '确认删除 Flow' })).toBeTruthy();

        await act(async () => {
            deleteDeferred.resolve(undefined);
            await deleteDeferred.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '确认删除 Flow' })).toBeNull();
        });
    });

    it('keeps the folder delete dialog open after failure, blocks dismissal while retrying, and closes it after success', async () => {
        const offlineApi = await import('../../api/offline');
        const firstAttempt = createDeferred<void>();
        const retryDeferred = createDeferred<void>();
        vi.mocked(offlineApi.deleteOfflineFolder)
            .mockReturnValueOnce(firstAttempt.promise)
            .mockReturnValueOnce(retryDeferred.promise);

        renderOfflineWorkbench();

        await openFolderDeleteDialog();
        expect(screen.getByRole('heading', { name: '确认删除文件夹' })).toBeTruthy();

        // trigger first delete attempt
        fireEvent.click(screen.getByRole('button', { name: '删除' }));

        // settle the first attempt as a failure inside act to ensure state updates
        await act(async () => {
            firstAttempt.reject(new Error('delete failed'));
            try {
                await firstAttempt.promise;
            } catch (e) {
                // ignore
            }
        });

        // Wait for the dialog to be back to idle retry state before clicking delete again.
        await waitFor(() => {
            const dlg = screen.getByRole('dialog', { name: '确认删除文件夹' });
            const btn = within(dlg).getByRole('button', { name: '删除' }) as HTMLButtonElement;
            if (btn.disabled) throw new Error('confirm button still disabled');
        });

        // Now retry the delete action using fresh DOM queries
        fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除文件夹' })).getByRole('button', { name: '删除' }));

        // Expect the ConfirmDialog to show the pending state label "处理中..." (product gap intentionally fails if missing)
        await waitFor(() => {
            const dlg = screen.getByRole('dialog', { name: '确认删除文件夹' });
            const loadingBtn = within(dlg).getByRole('button', { name: '处理中...' });
            expect(loadingBtn).toHaveAttribute('disabled');
            expect(within(dlg).getByRole('button', { name: '取消' })).toHaveAttribute('disabled');
        });

        fireEvent.keyDown(screen.getByRole('dialog', { name: '确认删除文件夹' }), { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: '确认删除文件夹' })).toBeTruthy();

        await act(async () => {
            retryDeferred.resolve(undefined);
            await retryDeferred.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '确认删除文件夹' })).toBeNull();
        });
    });
});

