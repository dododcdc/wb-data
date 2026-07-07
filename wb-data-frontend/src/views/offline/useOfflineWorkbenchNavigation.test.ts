import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowDraftSession } from './flowDraftController';
import { useOfflineWorkbenchNavigation, type OfflineNavigationBlocker } from './useOfflineWorkbenchNavigation';

function makeDraftSession(path = '_flows/example/flow.yaml'): FlowDraftSession {
    const document = {
        groupId: 1,
        path,
        flowId: 'example',
        namespace: 'team.example',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        stages: [],
        edges: [],
        layout: {},
    };
    return {
        path,
        baseDocument: document,
        workingDraft: document,
        selectedNodeId: null,
        selectedTaskIds: [],
        conflict: null,
    };
}

function renderNavigation(overrides: Partial<Parameters<typeof useOfflineWorkbenchNavigation>[0]> = {}) {
    const params = {
        groupId: 1,
        draftSession: null,
        isDirty: false,
        openFlowDocumentFromSession: vi.fn().mockResolvedValue(true),
        saveCurrentFlow: vi.fn().mockResolvedValue(true),
        discardCurrentFlowDraft: vi.fn(),
        resetActiveFlow: vi.fn(),
        ...overrides,
    };
    return {
        params,
        ...renderHook(() => useOfflineWorkbenchNavigation(params)),
    };
}

describe('useOfflineWorkbenchNavigation', () => {
    it('opens a Flow immediately when there is no dirty draft', async () => {
        const { result, params } = renderNavigation();

        await act(async () => {
            const opened = await result.current.openFlowDocument('_flows/example/flow.yaml');
            expect(opened).toBe(true);
        });

        expect(params.openFlowDocumentFromSession).toHaveBeenCalledWith('_flows/example/flow.yaml', {
            canLeaveDirty: true,
            skipLeaveCurrent: false,
        });
        expect(result.current.pendingNavigation).toBeNull();
    });

    it('stores pending Flow navigation when the current draft is dirty', async () => {
        const { result, params } = renderNavigation({
            draftSession: makeDraftSession(),
            isDirty: true,
        });

        await act(async () => {
            const opened = await result.current.openFlowDocument('_flows/second/flow.yaml');
            expect(opened).toBe(false);
        });

        expect(params.openFlowDocumentFromSession).not.toHaveBeenCalled();
        expect(result.current.pendingNavigation).toEqual({
            type: 'flow',
            flowPath: '_flows/second/flow.yaml',
        });
    });

    it('discards before opening a pending Flow navigation', async () => {
        const { result, params } = renderNavigation({
            draftSession: makeDraftSession(),
            isDirty: true,
        });

        await act(async () => {
            await result.current.openFlowDocument('_flows/second/flow.yaml');
        });
        await act(async () => {
            await result.current.confirmLeave('discard');
        });

        expect(params.discardCurrentFlowDraft).toHaveBeenCalledTimes(1);
        expect(params.openFlowDocumentFromSession).toHaveBeenCalledWith('_flows/second/flow.yaml', {
            force: true,
            canLeaveDirty: true,
            skipLeaveCurrent: true,
        });
        expect(result.current.pendingNavigation).toBeNull();
    });

    it('saves before opening a pending Flow navigation', async () => {
        const { result, params } = renderNavigation({
            draftSession: makeDraftSession(),
            isDirty: true,
        });

        await act(async () => {
            await result.current.openFlowDocument('_flows/second/flow.yaml');
        });
        await act(async () => {
            await result.current.confirmLeave('save');
        });

        expect(params.saveCurrentFlow).toHaveBeenCalledTimes(1);
        expect(params.discardCurrentFlowDraft).not.toHaveBeenCalled();
        expect(params.openFlowDocumentFromSession).toHaveBeenCalledWith('_flows/second/flow.yaml', {
            force: true,
            canLeaveDirty: true,
            skipLeaveCurrent: false,
        });
        expect(result.current.pendingNavigation).toBeNull();
    });

    it('keeps pending navigation when save fails', async () => {
        const { result, params } = renderNavigation({
            draftSession: makeDraftSession(),
            isDirty: true,
            saveCurrentFlow: vi.fn().mockResolvedValue(false),
        });

        await act(async () => {
            await result.current.openFlowDocument('_flows/second/flow.yaml');
        });
        await act(async () => {
            await result.current.confirmLeave('save');
        });

        expect(params.openFlowDocumentFromSession).not.toHaveBeenCalled();
        expect(result.current.pendingNavigation).toEqual({
            type: 'flow',
            flowPath: '_flows/second/flow.yaml',
        });
    });

    it('resets a router blocker when cancelling router navigation', () => {
        const blocker: OfflineNavigationBlocker = {
            proceed: vi.fn(),
            reset: vi.fn(),
        };
        const { result } = renderNavigation();

        act(() => {
            result.current.setPendingRouterNavigation(blocker);
        });
        act(() => {
            result.current.cancelLeave();
        });

        expect(blocker.reset).toHaveBeenCalledTimes(1);
        expect(blocker.proceed).not.toHaveBeenCalled();
        expect(result.current.pendingNavigation).toBeNull();
    });
});
