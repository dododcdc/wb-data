import { act, renderHook } from '@testing-library/react';
import type { Edge, Node } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineFlowDocument } from '../../api/offline';
import type { FlowDraftSession } from './flowDraftController';
import { useFlowExecutionAndSchedule } from './useFlowExecutionAndSchedule';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        createOfflineDocumentDebugExecution: vi.fn(),
        getOfflineExecution: vi.fn(),
        getOfflineSchedule: vi.fn(),
        listOfflineExecutions: vi.fn(),
        stopAllOfflineExecutions: vi.fn(),
        stopOfflineExecution: vi.fn(),
    };
});

function makeDocument(): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/jack/test/flow.yaml',
        flowId: 'test',
        namespace: 'g1-main',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        stages: [{
            stageId: 'stage_1',
            parallel: false,
            nodes: [{
                taskId: 'shell_node_1',
                kind: 'SHELL',
                scriptContent: 'echo hello',
                scriptPath: 'scripts/jack/test/shell_node_1.sh',
            }],
        }],
        edges: [],
        layout: {},
    };
}

function makeSession(document = makeDocument()): FlowDraftSession {
    return {
        path: document.path,
        baseDocument: document,
        workingDraft: document,
        selectedNodeId: 'shell_node_1',
        selectedTaskIds: ['shell_node_1'],
        conflict: null,
    };
}

function renderExecutionAndSchedule(overrides: Partial<Parameters<typeof useFlowExecutionAndSchedule>[0]> = {}) {
    const document = makeDocument();
    const params = {
        groupId: 1,
        activeFlowPath: document.path,
        draftSession: makeSession(document),
        flowDocument: document,
        selectedTaskIds: ['shell_node_1'],
        nodeEditorOpen: false,
        defaultTimezone: 'Asia/Singapore',
        canvasNodesRef: { current: [] as Node[] },
        canvasEdgesRef: { current: [] as Edge[] },
        setDraftSession: vi.fn(),
        showFeedback: vi.fn(),
        ...overrides,
    };
    return {
        params,
        ...renderHook(() => useFlowExecutionAndSchedule(params)),
    };
}

describe('useFlowExecutionAndSchedule', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads schedule from the draft before reading the backend', async () => {
        const offlineApi = await import('../../api/offline');
        const document = {
            ...makeDocument(),
            schedule: {
                cron: '* * * * *',
                timezone: 'Asia/Singapore',
                enabled: true,
            },
        };
        const { result } = renderExecutionAndSchedule({
            draftSession: makeSession(document),
            flowDocument: document,
        });

        await act(async () => {
            await result.current.loadScheduleSnapshot(document.path);
        });

        expect(offlineApi.getOfflineSchedule).not.toHaveBeenCalled();
        expect(result.current.schedule?.cron).toBe('* * * * *');
        expect(result.current.schedule?.enabled).toBe(true);
    });

    it('does not reuse a different Flow draft schedule when switching flows', async () => {
        const offlineApi = await import('../../api/offline');
        const previousDocument = {
            ...makeDocument(),
            path: '_flows/jack/codex_flow_jack_2153/flow.yaml',
            flowId: 'codex_flow_jack_2153',
            schedule: {
                cron: '* * * * *',
                timezone: 'Asia/Singapore',
                enabled: true,
            },
        };
        const nextPath = '_flows/codex_flow_session_2140/flow.yaml';
        vi.mocked(offlineApi.getOfflineSchedule).mockResolvedValue({
            groupId: 1,
            path: nextPath,
            triggerId: 'schedule',
            cron: '* * * * *',
            timezone: 'Asia/Singapore',
            enabled: false,
            contentHash: 'hash-next',
            fileUpdatedAt: 2,
        });
        const { result } = renderExecutionAndSchedule({
            activeFlowPath: nextPath,
            draftSession: makeSession(previousDocument),
            flowDocument: previousDocument,
        });

        await act(async () => {
            await result.current.loadScheduleSnapshot(nextPath);
        });

        expect(offlineApi.getOfflineSchedule).toHaveBeenCalledWith(1, nextPath);
        expect(result.current.schedule?.path).toBe(nextPath);
        expect(result.current.schedule?.enabled).toBe(false);
    });

    it('toggles schedule by updating the draft without calling the schedule API', async () => {
        const offlineApi = await import('../../api/offline');
        const { result, params } = renderExecutionAndSchedule();

        act(() => {
            result.current.setScheduleCron('* * * * *');
            result.current.setScheduleTimezone('Asia/Singapore');
        });
        await act(async () => {
            await result.current.toggleSchedule(true);
        });

        expect(offlineApi.getOfflineSchedule).not.toHaveBeenCalled();
        expect(params.setDraftSession).toHaveBeenCalledWith(expect.objectContaining({
            workingDraft: expect.objectContaining({
                schedule: {
                    cron: '* * * * *',
                    timezone: 'Asia/Singapore',
                    enabled: true,
                },
            }),
        }));
    });

    it('executes with the current draft document and selected nodes', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.createOfflineDocumentDebugExecution).mockResolvedValue({
            executionId: 'exec-1',
            mode: 'DRAFT_SELECTED',
            flowPath: '_flows/jack/test/flow.yaml',
            sourceRevision: 'draft',
            status: 'CREATED',
            createdAt: '2026-07-04T00:00:00Z',
        });
        vi.mocked(offlineApi.listOfflineExecutions).mockResolvedValue([]);
        const { result } = renderExecutionAndSchedule();

        await act(async () => {
            await result.current.execute();
        });

        expect(offlineApi.createOfflineDocumentDebugExecution).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 1,
            flowPath: '_flows/jack/test/flow.yaml',
            selectedTaskIds: ['shell_node_1'],
        }));
        expect(result.current.executionDialogOpen).toBe(true);
    });
});
