import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
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
