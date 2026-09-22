import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowDraftSession } from './flowDraftController';
import { useOfflineWorkbenchNavigation } from './useOfflineWorkbenchNavigation';

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
        flushDraft: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
    return {
        params,
        ...renderHook(() => useOfflineWorkbenchNavigation(params)),
    };
}

describe('useOfflineWorkbenchNavigation', () => {
    it('opens a Flow immediately without flushing when there is no dirty draft', async () => {
        const { result, params } = renderNavigation();

        await act(async () => {
            const opened = await result.current.openFlowDocument('_flows/example/flow.yaml');
            expect(opened).toBe(true);
        });

        expect(params.flushDraft).not.toHaveBeenCalled();
        expect(params.openFlowDocumentFromSession).toHaveBeenCalledWith('_flows/example/flow.yaml', {
            canLeaveDirty: true,
        });
    });

    it('flushes the dirty draft before switching to another Flow', async () => {
        const { result, params } = renderNavigation({
            draftSession: makeDraftSession(),
            isDirty: true,
        });

        await act(async () => {
            const opened = await result.current.openFlowDocument('_flows/second/flow.yaml');
            expect(opened).toBe(true);
        });

        expect(params.flushDraft).toHaveBeenCalledTimes(1);
        expect(params.openFlowDocumentFromSession).toHaveBeenCalledWith('_flows/second/flow.yaml', {
            canLeaveDirty: true,
        });
    });

    it('still switches when the flush fails (best-effort flush)', async () => {
        const { result, params } = renderNavigation({
            draftSession: makeDraftSession(),
            isDirty: true,
            flushDraft: vi.fn().mockResolvedValue(false),
        });

        await act(async () => {
            const opened = await result.current.openFlowDocument('_flows/second/flow.yaml');
            expect(opened).toBe(true);
        });

        expect(params.flushDraft).toHaveBeenCalledTimes(1);
        expect(params.openFlowDocumentFromSession).toHaveBeenCalledWith('_flows/second/flow.yaml', {
            canLeaveDirty: true,
        });
    });

    it('does not flush when opening the same Flow', async () => {
        const { result, params } = renderNavigation({
            draftSession: makeDraftSession(),
            isDirty: true,
        });

        await act(async () => {
            await result.current.openFlowDocument('_flows/example/flow.yaml');
        });

        expect(params.flushDraft).not.toHaveBeenCalled();
    });
});
