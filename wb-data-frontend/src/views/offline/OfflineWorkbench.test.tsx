import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import OfflineWorkbench from './OfflineWorkbench';
import { removeRecoverySnapshot } from './recoverySnapshotStore';
import type { OfflineFlowNodeKind } from '../../api/offline';

const { authState, feedbackSpy, flowCanvasRenderSpy } = vi.hoisted(() => ({
    authState: {
        userInfo: { id: 7 },
        systemAdmin: false,
        currentGroup: { id: 1, name: 'Team' },
        permissions: ['offline.write'],
    },
    feedbackSpy: vi.fn(),
    flowCanvasRenderSpy: vi.fn(),
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
    default: ({
        flowDocument,
        onAddNode,
        onEdgesChange,
        onNodeLayoutCommit,
        onRenameNode,
        onDoubleClickNode,
    }: {
        flowDocument: {
            path: string;
            stages: Array<{ nodes: Array<{ taskId: string; kind: string }> }>;
        };
        onAddNode: (kind: OfflineFlowNodeKind, position: { x: number; y: number }) => void;
        onEdgesChange: (edges: Array<{ id: string; source: string; target: string }>) => void;
        onNodeLayoutCommit: (nodes: Array<{ id: string; position: { x: number; y: number } }>) => void;
        onRenameNode: (oldId: string, newId: string) => void;
        onDoubleClickNode: (taskId: string) => void;
    }) => {
        flowCanvasRenderSpy(flowDocument);
        const transferNode = flowDocument.stages.flatMap((stage) => stage.nodes).find((node) => node.kind === 'TRANSFER');
        return (
            <div data-testid="flow-canvas">
                {flowDocument.path}
                <span data-testid="transfer-node-count">
                    {flowDocument.stages.flatMap((stage) => stage.nodes).filter((node) => node.kind === 'TRANSFER').length}
                </span>
                {transferNode && (
                    <button type="button" aria-label="打开传输节点" onClick={() => onDoubleClickNode(transferNode.taskId)}>
                        open-transfer
                    </button>
                )}
                <button
                    type="button"
                    aria-label="模拟画布修改"
                    onClick={() => onNodeLayoutCommit([{ id: 'node_1', position: { x: 32, y: 48 } }])}
                >
                    mutate
                </button>
                <button
                    type="button"
                    aria-label="模拟连续新增和重命名"
                    onClick={() => {
                        onAddNode('SHELL', { x: 100, y: 120 });
                        onEdgesChange([{ id: 'node_1->shell_node_1', source: 'node_1', target: 'shell_node_1' }]);
                        onRenameNode('node_1', 'renamed_node');
                    }}
                >
                    add-and-rename
                </button>
                <button
                    type="button"
                    aria-label="模拟新增后重命名新增节点"
                    onClick={() => {
                        onAddNode('SHELL', { x: 100, y: 120 });
                        onRenameNode('shell_node_1', 'created_node');
                        onEdgesChange([{ id: 'node_1->created_node', source: 'node_1', target: 'created_node' }]);
                    }}
                >
                    add-rename-created
                </button>
                <button
                    type="button"
                    aria-label="模拟连续新增超过上限"
                    onClick={() => {
                        onAddNode('SHELL', { x: 100, y: 120 });
                        onAddNode('SHELL', { x: 140, y: 160 });
                    }}
                >
                    add-past-limit
                </button>
                <button
                    type="button"
                    aria-label="模拟悬空连线"
                    onClick={() => {
                        onEdgesChange([{ id: 'node_1->missing_node', source: 'node_1', target: 'missing_node' }]);
                    }}
                >
                    dangling-edge
                </button>
            </div>
        );
    },
}));

vi.mock('./useNodeEditorDataSources', () => ({
    prefetchNodeEditorDataSources: vi.fn(() => Promise.resolve()),
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

vi.mock('../../api/datasource', () => ({
    getDataSourceById: vi.fn(() => Promise.reject(new Error('not found'))),
    getDataSourcePage: vi.fn(() => Promise.resolve({ records: [], total: 0, size: 200, current: 1, pages: 0 })),
}));

vi.mock('../../api/transfer', () => ({
    getTransferDatabases: vi.fn(() => Promise.resolve([])),
    getTransferTables: vi.fn(() => Promise.resolve({ data: [], total: 0, page: 1, size: 200 })),
    getTransferTableMetadata: vi.fn(() => Promise.resolve({
        columns: [{ name: 'id', type: 'BIGINT', size: 0, nullable: false, remarks: '', primaryKey: false }],
        partitionColumns: [],
        partitioned: false,
        writeModes: [{ value: 'append', label: 'Append' }],
    })),
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
        listBranches: vi.fn(),
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
        hasRemote: false,
        hasUpstream: false,
        branch: 'main',
        headCommitId: 'abc',
        headCommitMessage: 'init',
        headCommitAt: '2026-04-23T00:00:00Z',
    };
}

function makeRepoTree(options?: { includeFolder?: boolean; includeSecondFlow?: boolean }) {
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
    if (options?.includeSecondFlow) {
        children.push({
            id: 'flow-2',
            kind: 'FLOW',
            name: 'Second Flow',
            path: '_flows/second/flow.yaml',
            children: [],
        });
    }
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
    return makeFlowDocumentForPath('_flows/example/flow.yaml');
}

function makeFlowDocumentForPath(path: string) {
    const flowId = path.includes('/second/') ? 'second' : 'example';
    return {
        ...makeFlowDocumentBase(path, flowId),
        documentHash: 'base-hash',
        documentUpdatedAt: 100,
    };
}

function makeFlowDocumentWithNodeCount(nodeCount: number) {
    const nodes = Array.from({ length: nodeCount }, (_, index) => {
        const taskId = `node_${index + 1}`;
        return {
            taskId,
            kind: 'SHELL' as const,
            scriptPath: `scripts/example/${taskId}.sh`,
            scriptContent: `echo ${index + 1}`,
        };
    });

    return {
        ...makeFlowDocument(),
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes,
            },
        ],
        layout: Object.fromEntries(nodes.map((node, index) => [
            node.taskId,
            { x: index * 40, y: 0 },
        ])),
    };
}

function makeFlowDocumentWithTransferNode() {
    return {
        ...makeFlowDocument(),
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes: [
                    {
                        taskId: 'transfer_orders',
                        kind: 'TRANSFER' as const,
                        scriptPath: 'transfers/example/transfer_orders.transfer.json',
                        scriptContent: '',
                        transfer: {
                            source: { dataSourceId: 1, dataSourceType: 'MYSQL' as const, table: 'orders' },
                            target: { dataSourceId: 2, dataSourceType: 'HIVE' as const, table: 'dwd_orders', writeMode: 'append' as const },
                            fieldMappings: [{ target: 'id', kind: 'source_field' as const, source: 'id' }],
                            partitions: [],
                        },
                    },
                ],
            },
        ],
        layout: {
            transfer_orders: { x: 0, y: 0 },
        },
    };
}

function makeFlowDocumentBase(path = '_flows/example/flow.yaml', flowId = 'example') {
    return {
        groupId: 1,
        path,
        flowId,
        namespace: `team.${flowId}`,
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

function makeBranchList() {
    return {
        branches: [
            { name: 'main', current: true, local: true, remote: true, remoteName: 'origin/main', trackingBranch: 'origin/main' },
            { name: 'dev', current: false, local: true, remote: true, remoteName: 'origin/dev', trackingBranch: 'origin/dev' },
        ],
    };
}

function makeDirtyWorkingTreeError() {
    return new AxiosError(
        'Conflict',
        undefined,
        undefined,
        undefined,
        {
            data: {
                code: 409,
                message: '工作区有未提交改动',
                data: {
                    changedFlows: ['_flows/example/flow.yaml'],
                    changedFlowDetails: [
                        { path: '_flows/example/flow.yaml', status: 'MODIFIED' },
                    ],
                    changedFiles: ['_flows/example/flow.yaml'],
                    otherFileCount: 0,
                },
            },
            status: 409,
            statusText: 'Conflict',
            headers: AxiosHeaders.from({}),
            config: {
                headers: AxiosHeaders.from({}),
            },
        },
    );
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
        vi.mocked(offlineApi.listBranches).mockResolvedValue(makeBranchList());
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

    it('adds a transfer node from the toolbar', async () => {
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: '添加传输节点' }));

        await waitFor(() => {
            expect(screen.getByTestId('transfer-node-count').textContent).toBe('1');
        });
    });

    it('stabilizes transfer draft reporting when opening a transfer node editor', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.getOfflineFlowDocument).mockResolvedValue(makeFlowDocumentWithTransferNode());

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');
        flowCanvasRenderSpy.mockClear();

        fireEvent.click(screen.getByRole('button', { name: '打开传输节点' }));
        await screen.findByTestId('transfer-node-dialog');

        await waitFor(() => {
            expect(flowCanvasRenderSpy.mock.calls.length).toBeGreaterThan(0);
        });
        const renderCountAfterOpen = flowCanvasRenderSpy.mock.calls.length;

        await act(async () => {
            await Promise.resolve();
        });

        expect(flowCanvasRenderSpy.mock.calls.length).toBe(renderCountAfterOpen);
    });

    it('shows repo commit and push for group admins', async () => {
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];

        renderOfflineWorkbench();

        expect(screen.getByRole('button', { name: '提交仓库改动' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '推送' })).toBeTruthy();
    });

    it('allows first push when the current branch has no upstream yet', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue({
            ...makeRepoStatus(),
            hasRemote: true,
            hasUpstream: false,
            ahead: false,
        });

        renderOfflineWorkbench();

        await waitFor(() => {
            expect((screen.getByRole('button', { name: '推送' }) as HTMLButtonElement).disabled).toBe(false);
        });
    });

    it('shows current branch as read-only status for developers', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];

        renderOfflineWorkbench();

        expect(await screen.findByText('main')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /切换分支/ })).toBeNull();
        expect(offlineApi.listBranches).not.toHaveBeenCalled();
    });

    it('lets group admins switch branch from the left rail branch selector', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.switchBranch).mockResolvedValueOnce(null);
        const branchChangedListener = vi.fn();
        window.addEventListener('wbdata:offline-branch-changed', branchChangedListener);

        renderOfflineWorkbench();

        expect(screen.queryByText('工作分支')).toBeNull();
        const branchSelector = await screen.findByRole('button', { name: /切换分支，当前 main/ });
        expect(branchSelector.getAttribute('title')).toBeNull();
        fireEvent.mouseEnter(branchSelector);
        expect(branchSelector.getAttribute('aria-expanded')).toBe('false');
        expect(offlineApi.listBranches).not.toHaveBeenCalled();
        fireEvent.click(branchSelector);

        await screen.findByRole('dialog', { name: '切换分支' });
        expect(screen.queryByText('切换分支')).toBeNull();
        expect(screen.queryByText('本地分支')).toBeNull();
        expect(screen.queryByText('远程分支')).toBeNull();
        expect(screen.queryByText('origin/main')).toBeNull();
        expect(screen.queryByLabelText('当前分支')).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: /切换到 dev/ }));

        await waitFor(() => {
            expect(offlineApi.switchBranch).toHaveBeenCalledWith(1, 'dev');
        });
        await waitFor(() => {
            expect(offlineApi.getOfflineRepoStatus).toHaveBeenCalledTimes(2);
            expect(offlineApi.getOfflineRepoTree).toHaveBeenCalledTimes(2);
        });
        expect(branchChangedListener).toHaveBeenCalledWith(expect.objectContaining({
            detail: expect.objectContaining({ groupId: 1, branch: 'dev' }),
        }));
        window.removeEventListener('wbdata:offline-branch-changed', branchChangedListener);
    });

    it('closes the branch menu when clicking outside or pressing Escape', async () => {
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];

        renderOfflineWorkbench();

        const branchSelector = await screen.findByRole('button', { name: /切换分支，当前 main/ });
        fireEvent.click(branchSelector);
        expect(await screen.findByRole('dialog', { name: '切换分支' })).toBeTruthy();
        expect(branchSelector.getAttribute('aria-expanded')).toBe('true');

        fireEvent.mouseDown(document.body);

        await waitFor(() => {
            expect(branchSelector.getAttribute('aria-expanded')).toBe('false');
        });
        expect(screen.queryByRole('dialog', { name: '切换分支' })).toBeNull();

        fireEvent.click(branchSelector);
        expect(await screen.findByRole('dialog', { name: '切换分支' })).toBeTruthy();
        expect(branchSelector.getAttribute('aria-expanded')).toBe('true');

        fireEvent.keyDown(document, { key: 'Escape' });

        await waitFor(() => {
            expect(branchSelector.getAttribute('aria-expanded')).toBe('false');
        });
        expect(screen.queryByRole('dialog', { name: '切换分支' })).toBeNull();
    });

    it('renders the no-switchable-branches message as a passive branch menu note', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.listBranches).mockResolvedValueOnce({
            branches: [
                { name: 'main', current: true, local: true, remote: true, remoteName: 'origin/main', trackingBranch: 'origin/main' },
            ],
        });

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: /切换分支，当前 main/ }));

        expect(await screen.findByRole('note', { name: '暂无其他可切换分支' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /暂无其他可切换分支/ })).toBeNull();
    });

    it('blocks branch switching when saved Flow changes are not committed', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.switchBranch).mockRejectedValueOnce(makeDirtyWorkingTreeError());

        renderOfflineWorkbench();

        fireEvent.click(await screen.findByRole('button', { name: /切换分支，当前 main/ }));
        fireEvent.click(await screen.findByRole('button', { name: /切换到 dev/ }));

        expect(await screen.findByText('还有已保存但未提交的 Flow')).toBeTruthy();
        expect(screen.getByText('example')).toBeTruthy();
        expect(screen.getByRole('button', { name: '打开提交仓库改动' })).toBeTruthy();
    });

    it('asks group admins to discard unsaved canvas draft before switching branch', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.switchBranch).mockResolvedValueOnce(null);

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');
        fireEvent.click(screen.getByRole('button', { name: '模拟画布修改' }));

        fireEvent.click(screen.getByRole('button', { name: /切换分支，当前 main/ }));
        fireEvent.click(await screen.findByRole('button', { name: /切换到 dev/ }));

        expect(await screen.findByRole('dialog', { name: '放弃画布草稿并切换分支' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '放弃草稿并切换' }));

        await waitFor(() => {
            expect(offlineApi.switchBranch).toHaveBeenCalledWith(1, 'dev');
        });
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
        fireEvent.change(await screen.findByPlaceholderText(/简要描述本次修改/), { target: { value: 'flow commit' } });
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        await waitFor(() => {
            expect(offlineApi.commitOfflineCurrentFlow).toHaveBeenCalledWith(1, '_flows/example/flow.yaml', 'flow commit');
        });
    });

    it('routes repo commit through the repo-scoped API', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue({
            ...makeRepoStatus(),
            dirty: true,
        });
        vi.mocked(offlineApi.commitOfflineRepo).mockResolvedValue({ success: true, message: 'ok' });

        renderOfflineWorkbench();

        // Select a flow first so the component is in a loaded state
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        // Now click repo commit
        fireEvent.click(screen.getByRole('button', { name: '提交仓库改动' }));
        const input = await screen.findByPlaceholderText(/简要描述本次修改/);
        fireEvent.change(input, { target: { value: 'repo commit' } });
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        await waitFor(() => {
            expect(offlineApi.commitOfflineRepo).toHaveBeenCalledWith(1, 'repo commit');
        });
    });

    it('preserves queued add and rename canvas mutations in the saved payload', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue({
            ...makeFlowDocument(),
            documentHash: 'saved-hash',
            documentUpdatedAt: 101,
        });

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: '模拟连续新增和重命名' }));
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalled();
        });

        const payload = vi.mocked(offlineApi.saveOfflineFlowDocument).mock.calls[0][0];
        const savedNodes = payload.stages.flatMap((stage) => stage.nodes);
        expect(savedNodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                taskId: 'renamed_node',
                scriptPath: 'scripts/example/renamed_node.sh',
            }),
            expect.objectContaining({
                taskId: 'shell_node_1',
                scriptPath: 'scripts/example/shell_node_1.sh',
            }),
        ]));
        expect(payload.edges).toEqual([{ source: 'renamed_node', target: 'shell_node_1' }]);
    });

    it('renames a newly added canvas node before saving when both happen in one canvas event', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue({
            ...makeFlowDocument(),
            documentHash: 'saved-hash',
            documentUpdatedAt: 101,
        });

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: '模拟新增后重命名新增节点' }));
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalled();
        });

        const payload = vi.mocked(offlineApi.saveOfflineFlowDocument).mock.calls[0][0];
        const savedNodes = payload.stages.flatMap((stage) => stage.nodes);
        expect(savedNodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                taskId: 'created_node',
                scriptPath: 'scripts/example/created_node.sh',
            }),
        ]));
        expect(savedNodes.some((node) => node.taskId === 'shell_node_1')).toBe(false);
        expect(payload.edges).toEqual([{ source: 'node_1', target: 'created_node' }]);
    });

    it('shows max-node feedback when consecutive canvas adds exceed the latest draft limit', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.getOfflineFlowDocument).mockResolvedValue(makeFlowDocumentWithNodeCount(19));

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: '模拟连续新增超过上限' }));

        await waitFor(() => {
            expect(feedbackSpy).toHaveBeenCalledWith({
                tone: 'info',
                title: '节点数量已达上限',
                detail: '离线 Flow 最多支持 20 个节点，请精简流程设计。',
            });
        });
    });

    it('blocks save and shows generic graph feedback when the draft has a dangling edge', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue({
            ...makeFlowDocument(),
            documentHash: 'saved-hash',
            documentUpdatedAt: 101,
        });

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: '模拟悬空连线' }));
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(feedbackSpy).toHaveBeenCalledWith({
                tone: 'error',
                title: '保存失败',
                detail: '',
            });
        });
        expect(offlineApi.saveOfflineFlowDocument).not.toHaveBeenCalled();
    });

    it('stages schedule changes before saving, committing, and pushing the current Flow', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write', 'group.settings'];
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue({
            ...makeFlowDocument(),
            documentHash: 'saved-hash',
            documentUpdatedAt: 101,
            schedule: {
                cron: '* * * * *',
                timezone: 'Asia/Singapore',
                enabled: true,
            },
        });
        vi.mocked(offlineApi.commitOfflineCurrentFlow).mockResolvedValue({ success: true, message: 'flow committed' });
        vi.mocked(offlineApi.pushOfflineRepo).mockResolvedValue({
            success: true,
            message: 'pushed',
            remoteUrl: 'https://github.example/team/wb-data-1',
            remoteCreated: false,
            remoteDeleted: false,
        });

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        await screen.findByTestId('flow-canvas');

        fireEvent.click(screen.getByRole('button', { name: '调度' }));
        const scheduleDialog = await screen.findByRole('dialog', { name: '调度配置' });
        const cronInputs = scheduleDialog.querySelectorAll<HTMLInputElement>('.offline-segmented-cron-input');
        fireEvent.change(cronInputs[0], { target: { value: '' } });
        fireEvent.change(cronInputs[1], { target: { value: '' } });
        fireEvent.click(within(scheduleDialog).getByRole('switch', { name: '启用调度' }));
        fireEvent.click(within(scheduleDialog).getByRole('button', { name: '暂存配置' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '调度配置' })).toBeNull();
        });
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalledWith(expect.objectContaining({
                groupId: 1,
                path: '_flows/example/flow.yaml',
                schedule: {
                    cron: '* * * * *',
                    timezone: 'Asia/Singapore',
                    enabled: true,
                },
            }));
        });

        fireEvent.click(screen.getByRole('button', { name: '提交当前 Flow' }));
        fireEvent.change(await screen.findByPlaceholderText(/简要描述本次修改/), { target: { value: 'schedule flow commit' } });
        fireEvent.click(screen.getByRole('button', { name: '提交' }));

        await waitFor(() => {
            expect(offlineApi.commitOfflineCurrentFlow).toHaveBeenCalledWith(1, '_flows/example/flow.yaml', 'schedule flow commit');
        });

        fireEvent.click(screen.getByRole('button', { name: '推送' }));
        const pushDialog = await screen.findByRole('dialog', { name: '推送' });
        fireEvent.click(within(pushDialog).getByRole('button', { name: '推送' }));

        await waitFor(() => {
            expect(offlineApi.pushOfflineRepo).toHaveBeenCalledWith(1);
        });
    });

    it('keeps the current Flow open when cancelling dirty Flow navigation', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.getOfflineRepoTree).mockResolvedValue(makeRepoTree({ includeSecondFlow: true }));
        vi.mocked(offlineApi.getOfflineFlowDocument).mockImplementation(async (_groupId, path) => makeFlowDocumentForPath(path));

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        expect((await screen.findByTestId('flow-canvas')).textContent).toContain('_flows/example/flow.yaml');

        fireEvent.click(screen.getByRole('button', { name: '模拟画布修改' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Second Flow' }));

        const dialog = await screen.findByRole('dialog', { name: '您有未保存的更改' });
        fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '您有未保存的更改' })).toBeNull();
        });
        expect(screen.getByTestId('flow-canvas').textContent).toContain('_flows/example/flow.yaml');
        expect(offlineApi.getOfflineFlowDocument).not.toHaveBeenCalledWith(1, '_flows/second/flow.yaml');
    });

    it('opens the target Flow after discarding dirty Flow navigation', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.getOfflineRepoTree).mockResolvedValue(makeRepoTree({ includeSecondFlow: true }));
        vi.mocked(offlineApi.getOfflineFlowDocument).mockImplementation(async (_groupId, path) => makeFlowDocumentForPath(path));

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        expect((await screen.findByTestId('flow-canvas')).textContent).toContain('_flows/example/flow.yaml');

        fireEvent.click(screen.getByRole('button', { name: '模拟画布修改' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Second Flow' }));

        const dialog = await screen.findByRole('dialog', { name: '您有未保存的更改' });
        fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }));

        await waitFor(() => {
            expect(offlineApi.getOfflineFlowDocument).toHaveBeenCalledWith(1, '_flows/second/flow.yaml');
        });
        expect((await screen.findByTestId('flow-canvas')).textContent).toContain('_flows/second/flow.yaml');
    });

    it('saves before opening the target Flow during dirty Flow navigation', async () => {
        const offlineApi = await import('../../api/offline');
        authState.currentGroup = { id: 1, name: 'Team' };
        authState.permissions = ['offline.write'];
        vi.mocked(offlineApi.getOfflineRepoTree).mockResolvedValue(makeRepoTree({ includeSecondFlow: true }));
        vi.mocked(offlineApi.getOfflineFlowDocument).mockImplementation(async (_groupId, path) => makeFlowDocumentForPath(path));
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue({
            ...makeFlowDocumentForPath('_flows/example/flow.yaml'),
            documentHash: 'saved-hash',
            documentUpdatedAt: 101,
        });

        renderOfflineWorkbench();
        fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
        expect((await screen.findByTestId('flow-canvas')).textContent).toContain('_flows/example/flow.yaml');

        fireEvent.click(screen.getByRole('button', { name: '模拟画布修改' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Second Flow' }));

        const dialog = await screen.findByRole('dialog', { name: '您有未保存的更改' });
        fireEvent.click(within(dialog).getByRole('button', { name: '保存并离开' }));

        await waitFor(() => {
            expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalledWith(expect.objectContaining({
                groupId: 1,
                path: '_flows/example/flow.yaml',
            }));
            expect(offlineApi.getOfflineFlowDocument).toHaveBeenCalledWith(1, '_flows/second/flow.yaml');
        });
        expect((await screen.findByTestId('flow-canvas')).textContent).toContain('_flows/second/flow.yaml');
    });
});

describe('OfflineWorkbench branch menu motion', () => {
    function cssBlock(css: string, selector: string) {
        const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return css.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? '';
    }

    it('matches the navbar dropdown expansion pattern with a reduced-motion override', () => {
        const css = readFileSync(join(process.cwd(), 'src/views/offline/OfflineWorkbench.css'), 'utf8');

        expect(css).toMatch(/\.offline-branch-menu\s*\{[\s\S]*grid-template-rows:\s*0fr/);
        expect(css).toMatch(/\.offline-branch-menu\.open\s*\{[\s\S]*grid-template-rows:\s*1fr/);
        expect(css).toMatch(/\.offline-branch-menu-inner\s*\{[\s\S]*overflow:\s*hidden/);
        expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.offline-branch-menu\s*\{[\s\S]*transition:\s*none/);
    });

    it('keeps the branch menu compact and free of redundant labels', () => {
        const css = readFileSync(join(process.cwd(), 'src/views/offline/OfflineWorkbench.css'), 'utf8');
        const menuBlock = cssBlock(css, '.offline-branch-menu');
        const surfaceBlock = cssBlock(css, '.offline-branch-menu-surface');
        const rowBlock = cssBlock(css, '.offline-branch-row');

        expect(css).not.toContain('.offline-branch-menu-header');
        expect(css).not.toContain('.offline-branch-current-mark');
        expect(menuBlock).toContain('width: max-content');
        expect(menuBlock).toContain('min-width: 160px');
        expect(menuBlock).toContain('max-width: 260px');
        expect(surfaceBlock).not.toContain('min-height');
        expect(surfaceBlock).toContain('padding: 6px');
        expect(rowBlock).toContain('min-height: 34px');
        expect(rowBlock).toContain('justify-content: flex-start');
    });

    it('keeps the branch switcher as a compact toolbar control', () => {
        const css = readFileSync(join(process.cwd(), 'src/views/offline/OfflineWorkbench.css'), 'utf8');
        const toolbarBlock = cssBlock(css, '.offline-rail-toolbar');
        const switcherBlock = cssBlock(css, '.offline-branch-switcher');
        const selectorBlock = cssBlock(css, '.offline-branch-selector');

        expect(css).not.toContain('.offline-branch-strip');
        expect(css).not.toContain('.offline-branch-strip-label');
        expect(toolbarBlock).toContain('justify-content: space-between');
        expect(switcherBlock).toContain('display: flex');
        expect(switcherBlock).toContain('flex: 1 1 auto');
        expect(switcherBlock).not.toContain('display: none');
        expect(selectorBlock).toContain('height: 30px');
        expect(selectorBlock).toContain('border-radius: 999px');
        expect(selectorBlock).toContain('var(--color-success)');
    });

    it('does not move the branch selector on hover', () => {
        const css = readFileSync(join(process.cwd(), 'src/views/offline/OfflineWorkbench.css'), 'utf8');

        expect(css).not.toMatch(/\.offline-branch-selector-button:hover[^{]*\{[^}]*transform:/);
        expect(css).not.toMatch(/\.offline-branch-selector-button\s*\{[^}]*transition:[^}]*transform/);
    });

    it('does not mark the current branch with a side stripe', () => {
        const css = readFileSync(join(process.cwd(), 'src/views/offline/OfflineWorkbench.css'), 'utf8');

        expect(css).not.toContain('.offline-branch-row.is-current::before');
        expect(css).not.toContain('#166534');
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
