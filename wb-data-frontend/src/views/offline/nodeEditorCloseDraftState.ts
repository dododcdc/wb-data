import type { PendingNodeEditorDraft } from './flowDraftController';

interface FinalizeNodeEditorDraftOnCloseParams {
    pendingDraft: PendingNodeEditorDraft | null;
    flushNow: (draft: PendingNodeEditorDraft) => void;
    cancel: () => void;
}

export function finalizeNodeEditorDraftOnClose(
    params: FinalizeNodeEditorDraftOnCloseParams
): null {
    const { pendingDraft, flushNow, cancel } = params;

    if (pendingDraft) {
        flushNow(pendingDraft);
        return null;
    }

    cancel();
    return null;
}
