import type { FlowDraftSession } from './flowDraftController';

interface ClearDeletedFolderDraftStateParams {
    activeFlowPath: string | null;
    deleteFolderPath: string;
    draftSession: FlowDraftSession | null;
    leaveCurrentFlow: (session: FlowDraftSession) => void;
}

interface ClearedDeletedFolderDraftState {
    activeFlowPath: string | null;
    draftSession: FlowDraftSession | null;
}

export function clearDeletedFolderDraftState(
    params: ClearDeletedFolderDraftStateParams
): ClearedDeletedFolderDraftState {
    const { activeFlowPath, deleteFolderPath, draftSession, leaveCurrentFlow } = params;

    if (!activeFlowPath || !activeFlowPath.startsWith(deleteFolderPath + '/')) {
        return {
            activeFlowPath,
            draftSession,
        };
    }

    if (draftSession) {
        leaveCurrentFlow(draftSession);
    }

    return {
        activeFlowPath: null,
        draftSession: null,
    };
}
