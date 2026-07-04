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
        renameOfflineFlow: vi.fn(),
        renameOfflineFolder: vi.fn(),
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
        expect(params.showFeedback).toHaveBeenCalledWith({ tone: 'success', title: 'Flow 创建成功', detail: '' });
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

    it('renames a folder containing the active Flow and reopens the moved Flow', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.renameOfflineFolder).mockResolvedValue(undefined as never);
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
            });
            result.current.setRenameFolderName('jack_renamed');
        });
        await act(async () => {
            await result.current.handleRenameFolder();
        });

        expect(offlineApi.renameOfflineFolder).toHaveBeenCalledWith(1, '_flows/jack', 'jack_renamed');
        expect(params.leaveCurrentFlow).toHaveBeenCalledWith(params.draftSession);
        expect(params.setDraftSession).toHaveBeenCalledWith(null);
        expect(params.setActiveFlowPath).toHaveBeenCalledWith('_flows/jack_renamed/test/flow.yaml');
        expect(params.openFlowDocument).toHaveBeenCalledWith('_flows/jack_renamed/test/flow.yaml');
    });
});
