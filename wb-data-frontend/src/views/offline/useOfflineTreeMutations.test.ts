import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineTreeMutations } from './useOfflineTreeMutations';
import type { FlowDraftSession } from './flowDraftController';
import type { OfflineFlowDocument } from '../../api/offline';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        createOfflineFolder: vi.fn(),
        deleteOfflineFlow: vi.fn(),
        deleteOfflineFolder: vi.fn(),
        moveOfflineFlow: vi.fn(),
        moveOfflineFolder: vi.fn(),
        saveOfflineFlowDocument: vi.fn(),
    };
});

function makeDocument(path = '_flows/jack/test/flow.yaml'): OfflineFlowDocument {
    return {
        groupId: 1,
        path,
        flowId: 'test',
        namespace: 'g1-main',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        stages: [],
        edges: [],
        layout: {},
    };
}

function makeSession(path = '_flows/jack/test/flow.yaml'): FlowDraftSession {
    const document = makeDocument(path);
    return {
        path,
        baseDocument: document,
        workingDraft: document,
        selectedNodeId: null,
        selectedTaskIds: [],
        conflict: null,
    };
}

function renderTreeMutations(overrides: Partial<Parameters<typeof useOfflineTreeMutations>[0]> = {}) {
    const params = {
        groupId: 1,
        activeFlowPath: '_flows/jack/test/flow.yaml',
        draftSession: makeSession(),
        refreshRepoTree: vi.fn().mockResolvedValue(undefined),
        openFlowDocument: vi.fn().mockResolvedValue(true),
        leaveCurrentFlow: vi.fn(),
        setActiveFlowPath: vi.fn(),
        setDraftSession: vi.fn(),
        showFeedback: vi.fn(),
        ...overrides,
    };

    return {
        params,
        ...renderHook(() => useOfflineTreeMutations(params)),
    };
}

describe('useOfflineTreeMutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a Flow at the selected parent path and opens it', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue(makeDocument('_flows/jack/new_flow/flow.yaml'));
        const { result, params } = renderTreeMutations();

        act(() => {
            result.current.setNewFlowParentPath('jack');
            result.current.setNewFlowName('new_flow');
        });
        await act(async () => {
            await result.current.handleCreateFlow();
        });

        expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 1,
            path: '_flows/jack/new_flow/flow.yaml',
            stages: [],
            edges: [],
            layout: {},
        }));
        expect(params.refreshRepoTree).toHaveBeenCalled();
        expect(params.openFlowDocument).toHaveBeenCalledWith('_flows/jack/new_flow/flow.yaml');
        expect(params.showFeedback).toHaveBeenCalledWith({ tone: 'success', title: '任务创建成功', detail: '' });
    });

    it('creates a Flow preserving the default runtime timezone', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue(makeDocument('_flows/jack/new_flow/flow.yaml'));
        const { result } = renderTreeMutations({ defaultTimezone: 'Asia/Kolkata' });

        act(() => {
            result.current.setNewFlowParentPath('jack');
            result.current.setNewFlowName('new_flow');
        });
        await act(async () => {
            await result.current.handleCreateFlow();
        });

        expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 1,
            path: '_flows/jack/new_flow/flow.yaml',
            runtimeTimezone: 'Asia/Kolkata',
        }));
    });

    it('creates a Flow with explicitly selected runtime timezone', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue(makeDocument('_flows/jack/new_flow/flow.yaml'));
        const { result } = renderTreeMutations({ defaultTimezone: 'Asia/Kolkata' });

        act(() => {
            result.current.setNewFlowParentPath('jack');
            result.current.setNewFlowName('new_flow');
            result.current.setNewFlowTimezone('America/New_York');
        });
        await act(async () => {
            await result.current.handleCreateFlow();
        });

        expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 1,
            path: '_flows/jack/new_flow/flow.yaml',
            runtimeTimezone: 'America/New_York',
        }));
    });

    it('creates with the selected cross-group policy and resets the next dialog to ALLOW', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue(makeDocument());
        const { result } = renderTreeMutations();
        expect(result.current.newFlowCrossGroupDependency).toBe('ALLOW');
        act(() => {
            result.current.setNewFlowName('private_flow');
            result.current.setNewFlowCrossGroupDependency('DENY');
        });
        await act(async () => { await result.current.handleCreateFlow(); });
        expect(offlineApi.saveOfflineFlowDocument).toHaveBeenCalledWith(expect.objectContaining({
            dependencyConfig: { dependencies: [], failurePolicy: 'CONTINUE', crossGroupDependency: 'DENY' },
        }));
        act(() => { result.current.openRootNewFlowDialog(); });
        expect(result.current.newFlowCrossGroupDependency).toBe('ALLOW');
    });

    it('keeps a blocked deletion open and preserves the active draft', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.deleteOfflineFlow).mockRejectedValue(new Error('存在下游任务依赖，请先解除依赖'));
        const { result, params } = renderTreeMutations();
        act(() => result.current.openDeleteFlowDialogFromContext({
            id: 'test', name: 'test', path: '_flows/jack/test/flow.yaml', kind: 'FLOW', children: [],
            scheduleState: 'NONE', schedulePeriod: null, dependencyCount: 0,
        }));
        await act(async () => { await result.current.handleDeleteFlow(); });
        expect(result.current.deleteFlowDialogOpen).toBe(true);
        expect(result.current.deleteFlowError).toContain('请先解除依赖');
        expect(params.setDraftSession).not.toHaveBeenCalled();
        expect(params.refreshRepoTree).not.toHaveBeenCalled();
    });

    it('clears the active Flow when deleting it', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.deleteOfflineFlow).mockResolvedValue(undefined as never);
        const { result, params } = renderTreeMutations();

        act(() => {
            result.current.openDeleteFlowDialogFromContext({
                id: 'flow-test',
                name: 'test',
                path: '_flows/jack/test/flow.yaml',
                kind: 'FLOW',
                children: [],
                scheduleState: 'NONE',
                schedulePeriod: null,
                dependencyCount: 0,
            });
        });
        await act(async () => {
            await result.current.handleDeleteFlow();
        });

        expect(offlineApi.deleteOfflineFlow).toHaveBeenCalledWith(1, '_flows/jack/test/flow.yaml');
        expect(params.setActiveFlowPath).toHaveBeenCalledWith(null);
        expect(params.setDraftSession).toHaveBeenCalledWith(null);
        expect(params.refreshRepoTree).toHaveBeenCalled();
    });

    it('uses the selected nested Flow name in rename and delete dialogs', () => {
        const { result } = renderTreeMutations();
        const flowNode = {
            id: 'flow-test11',
            name: 'test11',
            path: '_flows/jack/test11/flow.yaml',
            kind: 'FLOW' as const,
            children: [],
            scheduleState: 'NONE' as const,
            schedulePeriod: null,
            dependencyCount: 0,
        };

        act(() => {
            result.current.openRenameFlowDialogFromContext(flowNode);
        });

        expect(result.current.renameFlowOriginalName).toBe('test11');
        expect(result.current.renameFlowName).toBe('test11');

        act(() => {
            result.current.openDeleteFlowDialogFromContext(flowNode);
        });

        expect(result.current.deleteFlowName).toBe('test11');
    });

    it('renames a nested active Flow without moving it to the repository root', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.moveOfflineFlow).mockResolvedValue(undefined as never);
        const { result, params } = renderTreeMutations({
            activeFlowPath: '_flows/jack/test11/flow.yaml',
            draftSession: makeSession('_flows/jack/test11/flow.yaml'),
        });

        act(() => {
            result.current.openRenameFlowDialogFromContext({
                id: 'flow-test11',
                name: 'test11',
                path: '_flows/jack/test11/flow.yaml',
                kind: 'FLOW',
                children: [],
                scheduleState: 'NONE',
                schedulePeriod: null,
                dependencyCount: 0,
            });
            result.current.setRenameFlowName('test11_new');
        });
        await act(async () => {
            await result.current.handleRenameFlow();
        });

        expect(offlineApi.moveOfflineFlow).toHaveBeenCalledWith(1, '_flows/jack/test11/flow.yaml', '_flows/jack/test11_new/flow.yaml');
        expect(params.setActiveFlowPath).toHaveBeenCalledWith('_flows/jack/test11_new/flow.yaml');
        expect(params.openFlowDocument).toHaveBeenCalledWith('_flows/jack/test11_new/flow.yaml');
    });

    it('renames a folder containing the active Flow and reopens the moved Flow', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.moveOfflineFolder).mockResolvedValue(undefined as never);
        const { result, params } = renderTreeMutations({
            activeFlowPath: '_flows/jack/test/flow.yaml',
            draftSession: makeSession('_flows/jack/test/flow.yaml'),
        });

        act(() => {
            result.current.openRenameFolderDialogFromContext({
                id: 'folder-jack',
                name: 'jack',
                path: '_flows/jack',
                kind: 'DIRECTORY',
                children: [],
                scheduleState: 'NONE',
                schedulePeriod: null,
                dependencyCount: 0,
            });
            result.current.setRenameFolderName('jack_renamed');
        });
        await act(async () => {
            await result.current.handleRenameFolder();
        });

        expect(offlineApi.moveOfflineFolder).toHaveBeenCalledWith(1, '_flows/jack', '_flows/jack_renamed');
        expect(params.leaveCurrentFlow).toHaveBeenCalledWith(params.draftSession);
        expect(params.setDraftSession).toHaveBeenCalledWith(null);
        expect(params.setActiveFlowPath).toHaveBeenCalledWith('_flows/jack_renamed/test/flow.yaml');
        expect(params.openFlowDocument).toHaveBeenCalledWith('_flows/jack_renamed/test/flow.yaml');
    });
});
