import { useEffect, useRef } from 'react';
import type { FlowDraftSession } from './flowDraftController';
import type { OpenFlowDocumentOptions } from './useFlowEditingSession';

interface GroupLifecycleParams {
    groupId: number | null;
    leaveCurrentFlow: (session?: FlowDraftSession | null, groupOverride?: number | null) => void;
    resetActiveFlow: () => void;
    resetBranchList: () => void;
    resetBranchSwitchState: () => void;
    refreshWorkspace: () => Promise<void>;
}

interface BranchEventParams {
    groupId: number | null;
    resetActiveFlow: () => void;
    resetBranchList: () => void;
    resetBranchSwitchState: () => void;
    refreshWorkspace: () => Promise<void>;
}

interface UrlRestoreParams {
    groupId: number | null;
    repoTree: unknown;
    searchParams: URLSearchParams;
    openFlowDocument: (path: string, options?: OpenFlowDocumentOptions) => Promise<boolean>;
}

interface BeforeUnloadLeaveParams {
    groupId: number | null;
    draftSession: FlowDraftSession | null;
    leaveCurrentFlow: () => void;
}

interface NewFlowShortcutParams {
    newFlowDialogOpen: boolean;
    nodeEditorOpen: boolean;
    executionDialogOpen: boolean;
    scheduleDialogOpen: boolean;
    openRootNewFlowDialog: () => void;
}

export function useOfflineWorkbenchGroupLifecycle(params: GroupLifecycleParams) {
    const {
        groupId,
        leaveCurrentFlow,
        resetActiveFlow,
        resetBranchList,
        resetBranchSwitchState,
        refreshWorkspace,
    } = params;
    const previousGroupIdRef = useRef<number | null>(groupId);

    useEffect(() => {
        const previousGroupId = previousGroupIdRef.current;
        if (previousGroupId !== null && previousGroupId !== groupId) {
            leaveCurrentFlow(undefined, previousGroupId);
        }
        previousGroupIdRef.current = groupId;

        resetActiveFlow();
        resetBranchList();
        resetBranchSwitchState();

        if (!groupId) return;
        void refreshWorkspace();
    }, [groupId, leaveCurrentFlow, refreshWorkspace, resetActiveFlow, resetBranchList, resetBranchSwitchState]);
}

export function useOfflineWorkbenchBranchEvent(params: BranchEventParams) {
    const {
        groupId,
        resetActiveFlow,
        resetBranchList,
        resetBranchSwitchState,
        refreshWorkspace,
    } = params;

    useEffect(() => {
        const handleBranchChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ groupId?: number; source?: string }>).detail;
            if (!groupId || detail?.groupId !== groupId) return;
            if (detail?.source === 'workbench') return;

            resetBranchList();
            resetBranchSwitchState();
            resetActiveFlow();
            void refreshWorkspace();
        };

        window.addEventListener('wbdata:offline-branch-changed', handleBranchChanged);
        return () => window.removeEventListener('wbdata:offline-branch-changed', handleBranchChanged);
    }, [groupId, refreshWorkspace, resetActiveFlow, resetBranchList, resetBranchSwitchState]);
}

export function useOfflineWorkbenchUrlRestore(params: UrlRestoreParams) {
    const {
        groupId,
        repoTree,
        searchParams,
        openFlowDocument,
    } = params;
    const restoreFlowRef = useRef(false);

    useEffect(() => {
        if (!groupId || !repoTree || restoreFlowRef.current) return;
        const flowPath = searchParams.get('flowPath');
        if (!flowPath) return;
        restoreFlowRef.current = true;
        void openFlowDocument(flowPath, { force: true });
    }, [groupId, repoTree, searchParams, openFlowDocument]);
}

export function useOfflineWorkbenchBeforeUnloadLeave(params: BeforeUnloadLeaveParams) {
    const {
        groupId,
        draftSession,
        leaveCurrentFlow,
    } = params;

    useEffect(() => {
        if (!groupId || !draftSession) return;
        const handleBeforeUnload = () => {
            leaveCurrentFlow();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [draftSession, groupId, leaveCurrentFlow]);
}

export function useOfflineWorkbenchNewFlowShortcut(params: NewFlowShortcutParams) {
    const {
        newFlowDialogOpen,
        nodeEditorOpen,
        executionDialogOpen,
        scheduleDialogOpen,
        openRootNewFlowDialog,
    } = params;

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
                event.preventDefault();
                if (!newFlowDialogOpen && !nodeEditorOpen && !executionDialogOpen && !scheduleDialogOpen) {
                    openRootNewFlowDialog();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [newFlowDialogOpen, nodeEditorOpen, executionDialogOpen, scheduleDialogOpen, openRootNewFlowDialog]);
}
