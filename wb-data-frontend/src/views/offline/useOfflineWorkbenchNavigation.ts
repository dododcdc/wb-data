import { useCallback, useRef, useState } from 'react';
import type { FlowDraftSession } from './flowDraftController';
import type { OpenFlowDocumentOptions } from './useFlowEditingSession';

export interface OfflineNavigationBlocker {
    proceed?: () => void;
    reset?: () => void;
}

export type OfflinePendingNavigation =
    | { type: 'flow'; flowPath: string }
    | { type: 'router'; blocker: OfflineNavigationBlocker };

export interface UseOfflineWorkbenchNavigationParams {
    groupId: number | null;
    draftSession: FlowDraftSession | null;
    isDirty: boolean;
    openFlowDocumentFromSession: (path: string, options?: OpenFlowDocumentOptions) => Promise<boolean>;
    saveCurrentFlow: () => Promise<boolean>;
    discardCurrentFlowDraft: () => void;
    resetActiveFlow: () => void;
}

export function useOfflineWorkbenchNavigation(params: UseOfflineWorkbenchNavigationParams) {
    const {
        groupId,
        draftSession,
        isDirty,
        openFlowDocumentFromSession,
        saveCurrentFlow,
        discardCurrentFlowDraft,
        resetActiveFlow,
    } = params;
    const [pendingNavigation, setPendingNavigation] = useState<OfflinePendingNavigation | null>(null);
    const didDiscardLeaveRef = useRef(false);

    const openFlowDocument = useCallback(async (pathValue: string, options?: OpenFlowDocumentOptions) => {
        if (!groupId) return false;
        const normalizedPath = pathValue.trim();
        if (!normalizedPath) {
            return false;
        }

        const skipLeaveCurrent = didDiscardLeaveRef.current;
        if (!skipLeaveCurrent && draftSession && draftSession.path !== normalizedPath) {
            if (!options?.force && !options?.canLeaveDirty && isDirty) {
                setPendingNavigation({ type: 'flow', flowPath: normalizedPath });
                return false;
            }
        }
        didDiscardLeaveRef.current = false;

        return openFlowDocumentFromSession(normalizedPath, {
            ...options,
            canLeaveDirty: true,
            skipLeaveCurrent,
        });
    }, [draftSession, groupId, isDirty, openFlowDocumentFromSession]);

    const markDraftDiscardedForExternalSwitch = useCallback(() => {
        if (!draftSession) return;
        didDiscardLeaveRef.current = true;
        discardCurrentFlowDraft();
        resetActiveFlow();
    }, [discardCurrentFlowDraft, draftSession, resetActiveFlow]);

    const confirmLeave = useCallback(async (action: 'save' | 'discard') => {
        if (!pendingNavigation) return;

        if (action === 'save') {
            const saved = await saveCurrentFlow();
            if (!saved) return;
        } else if (draftSession) {
            didDiscardLeaveRef.current = true;
            discardCurrentFlowDraft();
        }

        const target = pendingNavigation;
        setPendingNavigation(null);

        if (target.type === 'router') {
            target.blocker.proceed?.();
        } else {
            void openFlowDocument(target.flowPath, { force: true });
        }
    }, [discardCurrentFlowDraft, draftSession, openFlowDocument, pendingNavigation, saveCurrentFlow]);

    const cancelLeave = useCallback(() => {
        if (!pendingNavigation) return;
        if (pendingNavigation.type === 'router') {
            pendingNavigation.blocker.reset?.();
        }
        setPendingNavigation(null);
    }, [pendingNavigation]);

    const setPendingRouterNavigation = useCallback((blocker: OfflineNavigationBlocker) => {
        setPendingNavigation({ type: 'router', blocker });
    }, []);

    return {
        pendingNavigation,
        openFlowDocument,
        markDraftDiscardedForExternalSwitch,
        confirmLeave,
        cancelLeave,
        setPendingRouterNavigation,
    };
}
