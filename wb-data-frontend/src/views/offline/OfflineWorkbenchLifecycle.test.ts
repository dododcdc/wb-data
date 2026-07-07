import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlowDraftSession } from './flowDraftController';
import {
    useOfflineWorkbenchBeforeUnloadLeave,
    useOfflineWorkbenchBranchEvent,
    useOfflineWorkbenchGroupLifecycle,
    useOfflineWorkbenchNewFlowShortcut,
    useOfflineWorkbenchUrlRestore,
} from './OfflineWorkbenchLifecycle';

function makeDraftSession(): FlowDraftSession {
    const document = {
        groupId: 1,
        path: '_flows/example/flow.yaml',
        flowId: 'example',
        namespace: 'team.example',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        stages: [],
        edges: [],
        layout: {},
    };
    return {
        path: document.path,
        baseDocument: document,
        workingDraft: document,
        selectedNodeId: null,
        selectedTaskIds: [],
        conflict: null,
    };
}

describe('OfflineWorkbenchLifecycle', () => {
    it('leaves the previous group and refreshes workspace when group changes', () => {
        const calls: string[] = [];
        const leaveCurrentFlow = vi.fn((_session, groupId) => calls.push(`leave:${groupId}`));
        const resetActiveFlow = vi.fn(() => calls.push('reset-active-flow'));
        const resetBranchList = vi.fn(() => calls.push('reset-branch-list'));
        const resetBranchSwitchState = vi.fn(() => calls.push('reset-branch-switch'));
        const refreshWorkspace = vi.fn(() => {
            calls.push('refresh');
            return Promise.resolve();
        });

        const { rerender } = renderHook(
            ({ groupId }) => useOfflineWorkbenchGroupLifecycle({
                groupId,
                leaveCurrentFlow,
                resetActiveFlow,
                resetBranchList,
                resetBranchSwitchState,
                refreshWorkspace,
            }),
            { initialProps: { groupId: 1 as number | null } },
        );
        calls.length = 0;

        rerender({ groupId: 2 });

        expect(calls).toEqual([
            'leave:1',
            'reset-active-flow',
            'reset-branch-list',
            'reset-branch-switch',
            'refresh',
        ]);
    });

    it('handles external branch changed events for the current group only', () => {
        const resetActiveFlow = vi.fn();
        const resetBranchList = vi.fn();
        const resetBranchSwitchState = vi.fn();
        const refreshWorkspace = vi.fn().mockResolvedValue(undefined);
        renderHook(() => useOfflineWorkbenchBranchEvent({
            groupId: 1,
            resetActiveFlow,
            resetBranchList,
            resetBranchSwitchState,
            refreshWorkspace,
        }));

        act(() => {
            window.dispatchEvent(new CustomEvent('wbdata:offline-branch-changed', {
                detail: { groupId: 2, source: 'external' },
            }));
            window.dispatchEvent(new CustomEvent('wbdata:offline-branch-changed', {
                detail: { groupId: 1, source: 'workbench' },
            }));
            window.dispatchEvent(new CustomEvent('wbdata:offline-branch-changed', {
                detail: { groupId: 1, source: 'settings' },
            }));
        });

        expect(resetBranchList).toHaveBeenCalledTimes(1);
        expect(resetBranchSwitchState).toHaveBeenCalledTimes(1);
        expect(resetActiveFlow).toHaveBeenCalledTimes(1);
        expect(refreshWorkspace).toHaveBeenCalledTimes(1);
    });

    it('restores the URL flowPath only once per mount', () => {
        const openFlowDocument = vi.fn().mockResolvedValue(true);
        const searchParams = new URLSearchParams('flowPath=_flows/example/flow.yaml');
        const { rerender } = renderHook(
            ({ repoTree }) => useOfflineWorkbenchUrlRestore({
                groupId: 1,
                repoTree,
                searchParams,
                openFlowDocument,
            }),
            { initialProps: { repoTree: null as object | null } },
        );

        rerender({ repoTree: { root: { id: 'root' } } });
        rerender({ repoTree: { root: { id: 'root' } } });

        expect(openFlowDocument).toHaveBeenCalledTimes(1);
        expect(openFlowDocument).toHaveBeenCalledWith('_flows/example/flow.yaml', { force: true });
    });

    it('leaves the current flow on beforeunload when a draft is open', () => {
        const leaveCurrentFlow = vi.fn();
        const { unmount } = renderHook(() => useOfflineWorkbenchBeforeUnloadLeave({
            groupId: 1,
            draftSession: makeDraftSession(),
            leaveCurrentFlow,
        }));

        act(() => {
            window.dispatchEvent(new Event('beforeunload'));
        });

        expect(leaveCurrentFlow).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('opens the new Flow dialog on Ctrl/Cmd+N only when dialogs are closed', () => {
        const openRootNewFlowDialog = vi.fn();
        const { rerender } = renderHook(
            ({ nodeEditorOpen }) => useOfflineWorkbenchNewFlowShortcut({
                newFlowDialogOpen: false,
                nodeEditorOpen,
                executionDialogOpen: false,
                scheduleDialogOpen: false,
                openRootNewFlowDialog,
            }),
            { initialProps: { nodeEditorOpen: false } },
        );

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
        });
        rerender({ nodeEditorOpen: true });
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
        });

        expect(openRootNewFlowDialog).toHaveBeenCalledTimes(1);
    });
});
