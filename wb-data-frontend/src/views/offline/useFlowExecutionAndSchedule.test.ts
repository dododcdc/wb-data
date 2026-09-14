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
        runtimeTimezone: 'Asia/Shanghai',
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

    it('clears the previous cron before the next Flow schedule finishes loading', async () => {
        const offlineApi = await import('../../api/offline');
        const nextPath = '_flows/jack/next/flow.yaml';
        let resolveSchedule: ((value: Awaited<ReturnType<typeof offlineApi.getOfflineSchedule>>) => void) | undefined;
        vi.mocked(offlineApi.getOfflineSchedule).mockImplementation(() => new Promise((resolve) => {
            resolveSchedule = resolve;
        }));
        const { result } = renderExecutionAndSchedule({
            activeFlowPath: nextPath,
            draftSession: makeSession({ ...makeDocument(), path: nextPath }),
        });

        act(() => {
            result.current.setScheduleCron('0 5 * * *');
        });

        let loadPromise: Promise<void> | undefined;
        act(() => {
            loadPromise = result.current.loadScheduleSnapshot(nextPath);
        });

        expect(result.current.scheduleCron).toBe('');

        await act(async () => {
            resolveSchedule?.({
                groupId: 1,
                path: nextPath,
                triggerId: 'schedule',
                cron: '0 7 * * *',
                timezone: 'Asia/Shanghai',
                enabled: false,
                contentHash: 'hash-next',
                fileUpdatedAt: 2,
            });
            await loadPromise;
        });

        expect(result.current.scheduleCron).toBe('0 7 * * *');
    });

    it('does not keep the previous cron when schedule loading fails', async () => {
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.getOfflineSchedule).mockRejectedValue(new Error('schedule unavailable'));
        const { result } = renderExecutionAndSchedule();

        act(() => {
            result.current.setScheduleCron('0 5 * * *');
        });

        await act(async () => {
            await result.current.loadScheduleSnapshot('_flows/jack/test/flow.yaml');
        });

        expect(result.current.scheduleCron).toBe('');
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
        });
        await act(async () => {
            await result.current.toggleSchedule(true);
        });

        expect(offlineApi.getOfflineSchedule).not.toHaveBeenCalled();
        expect(params.setDraftSession).toHaveBeenCalledWith(expect.objectContaining({
            workingDraft: expect.objectContaining({
                schedule: {
                    cron: '* * * * *',
                    timezone: 'Asia/Shanghai',
                    enabled: true,
                },
            }),
        }));
    });

    it('rejects enabling schedule when cron is invalid', async () => {
        const { result, params } = renderExecutionAndSchedule();

        act(() => {
            result.current.setScheduleCron('not a cron');
        });
        await act(async () => {
            await result.current.toggleSchedule(true);
        });

        expect(params.setDraftSession).not.toHaveBeenCalled();
        expect(params.showFeedback).toHaveBeenCalledWith({
            tone: 'error',
            title: 'Cron 表达式无效，无法开启调度',
            detail: '',
        });
    });

    it('allows disabling schedule even when cron is invalid', async () => {
        const { result, params } = renderExecutionAndSchedule();

        act(() => {
            result.current.setScheduleCron('%%%');
        });
        await act(async () => {
            await result.current.toggleSchedule(false);
        });

        expect(params.setDraftSession).toHaveBeenCalled();
        expect(params.showFeedback).toHaveBeenCalledWith(expect.objectContaining({
            tone: 'success',
            title: '调度关闭已暂存',
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

    it('asks for planned time whenever the Flow defines a planned-time parameter', async () => {
        const offlineApi = await import('../../api/offline');
        const document: OfflineFlowDocument = {
            ...makeDocument(),
            schedule: { cron: '0 2 * * *', timezone: 'Asia/Shanghai', enabled: true },
            parameterBinding: {
                parameterGroupId: 12,
                code: 'daily_common',
                name: '日常参数',
                boundVersion: 3,
                currentVersion: 3,
                status: 'CURRENT',
                definitions: [{
                    key: 'v_day',
                    valueSource: 'SYSTEM_TIME',
                    format: 'yyyyMMdd',
                    offsetDays: 0,
                    timeBasis: 'PLANNED_TIME',
                    sortOrder: 0,
                }],
            },
            stages: [{
                stageId: 'stage_1',
                parallel: false,
                nodes: [{
                    taskId: 'query',
                    kind: 'SQL',
                    scriptContent: 'select 1',
                    scriptPath: 'scripts/query.sql',
                    dataSourceId: 1,
                    dataSourceType: 'MYSQL',
                }],
            }],
        };
        vi.mocked(offlineApi.createOfflineDocumentDebugExecution).mockResolvedValue({
            executionId: 'exec-planned',
            mode: 'DRAFT_SELECTED',
            flowPath: document.path,
            sourceRevision: 'draft',
            status: 'CREATED',
            createdAt: '2026-08-16T00:00:00Z',
        });
        vi.mocked(offlineApi.listOfflineExecutions).mockResolvedValue([]);
        const { result } = renderExecutionAndSchedule({
            draftSession: makeSession(document),
            flowDocument: document,
            selectedTaskIds: ['query'],
        });

        await act(async () => {
            await result.current.execute();
        });

        expect(offlineApi.createOfflineDocumentDebugExecution).not.toHaveBeenCalled();
        expect(result.current.executionContextDialogOpen).toBe(true);
        expect(result.current.executionTimeRequirement.timezone).toBe('Asia/Shanghai');
        expect(result.current.plannedTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

        act(() => result.current.setPlannedTime('2026-01-01T02:00'));
        await act(async () => {
            await result.current.confirmExecution();
        });

        expect(offlineApi.createOfflineDocumentDebugExecution).toHaveBeenCalledWith(
            expect.objectContaining({ plannedTime: '2026-01-01T02:00' }),
        );
        expect(result.current.executionContextDialogOpen).toBe(false);
    });

    it('opens parameter settings for constant-only parameters without requiring planned time', async () => {
        const offlineApi = await import('../../api/offline');
        const document: OfflineFlowDocument = {
            ...makeDocument(),
            parameterBinding: {
                parameterGroupId: 12,
                code: 'daily_common',
                name: '日常参数',
                boundVersion: 3,
                currentVersion: 3,
                status: 'CURRENT',
                definitions: [{
                    key: 'tenant_name',
                    valueSource: 'CONSTANT',
                    constantValue: 'tom',
                    offsetDays: 0,
                    sortOrder: 0,
                }],
            },
        };
        vi.mocked(offlineApi.createOfflineDocumentDebugExecution).mockResolvedValue({
            executionId: 'exec-constant',
            mode: 'DRAFT_SELECTED',
            flowPath: document.path,
            sourceRevision: 'draft',
            status: 'CREATED',
            createdAt: '2026-08-16T00:00:00Z',
        });
        vi.mocked(offlineApi.listOfflineExecutions).mockResolvedValue([]);
        const { result } = renderExecutionAndSchedule({
            draftSession: makeSession(document),
            flowDocument: document,
        });

        await act(async () => {
            await result.current.execute();
        });

        expect(offlineApi.createOfflineDocumentDebugExecution).not.toHaveBeenCalled();
        expect(result.current.executionContextDialogOpen).toBe(true);
        expect(result.current.executionTimeRequirement.requiresPlannedTime).toBe(false);

        act(() => result.current.setParameterOverrides({ tenant_name: '' }));
        await act(async () => {
            await result.current.confirmExecution();
        });

        expect(offlineApi.createOfflineDocumentDebugExecution).toHaveBeenCalledWith(
            expect.objectContaining({ parameterOverrides: { tenant_name: '' } }),
        );
    });

    it('discards parameter overrides when the execution context dialog is cancelled', async () => {
        const document: OfflineFlowDocument = {
            ...makeDocument(),
            parameterBinding: {
                parameterGroupId: 12,
                code: 'daily_common',
                name: '日常参数',
                boundVersion: 3,
                currentVersion: 3,
                status: 'CURRENT',
                definitions: [{
                    key: 'tenant_name',
                    valueSource: 'CONSTANT',
                    constantValue: 'tom',
                    offsetDays: 0,
                    sortOrder: 0,
                }],
            },
        };
        const { result } = renderExecutionAndSchedule({
            draftSession: makeSession(document),
            flowDocument: document,
        });

        await act(async () => {
            await result.current.execute();
        });
        act(() => {
            result.current.setParameterOverrides({ tenant_name: 'override' });
        });
        act(() => {
            result.current.setExecutionContextDialogOpen(false);
        });

        expect(result.current.parameterOverrides).toEqual({});

        await act(async () => {
            await result.current.execute();
        });

        expect(result.current.executionContextDialogOpen).toBe(true);
        expect(result.current.parameterOverrides).toEqual({});
    });

    it('includes saved transfer configuration when debugging a selected transfer node', async () => {
        const offlineApi = await import('../../api/offline');
        const transfer = {
            source: { dataSourceId: 11, dataSourceType: 'MYSQL' as const, table: 'orders' },
            target: { dataSourceId: 12, dataSourceType: 'HIVE' as const, table: 'dwd_orders', writeMode: 'append' as const },
            fieldMappings: [{ target: 'order_id', kind: 'source_field' as const, source: 'id' }],
            partitions: [],
        };
        const document = {
            ...makeDocument(),
            stages: [{
                stageId: 'stage_1',
                parallel: false,
                nodes: [{ taskId: 'transfer_orders', kind: 'TRANSFER' as const, transfer }],
            }],
        };
        vi.mocked(offlineApi.createOfflineDocumentDebugExecution).mockResolvedValue({
            executionId: 'exec-transfer',
            mode: 'DRAFT_SELECTED',
            flowPath: document.path,
            sourceRevision: 'draft',
            status: 'CREATED',
            createdAt: '2026-07-04T00:00:00Z',
        });
        vi.mocked(offlineApi.listOfflineExecutions).mockResolvedValue([]);
        const { result } = renderExecutionAndSchedule({
            draftSession: makeSession(document),
            flowDocument: document,
            selectedTaskIds: ['transfer_orders'],
        });

        await act(async () => {
            await result.current.execute();
        });

        expect(offlineApi.createOfflineDocumentDebugExecution).toHaveBeenCalledWith(expect.objectContaining({
            selectedTaskIds: ['transfer_orders'],
            stages: [expect.objectContaining({
                nodes: [expect.objectContaining({
                    taskId: 'transfer_orders',
                    kind: 'TRANSFER',
                    transfer,
                })],
            })],
        }));
    });
});
