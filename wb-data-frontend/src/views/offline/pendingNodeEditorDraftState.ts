import type { OfflineFlowDocument } from '../../api/offline';
import type { PendingNodeEditorDraft } from './flowDraftController';

export function resolvePendingNodeEditorDraftAfterDocumentChange(
    pendingDraft: PendingNodeEditorDraft | null,
    nextDocument: OfflineFlowDocument
): PendingNodeEditorDraft | null {
    if (!pendingDraft) {
        return null;
    }

    const stillExists = nextDocument.stages.some((stage) =>
        stage.nodes.some((node) => node.taskId === pendingDraft.taskId)
    );

    return stillExists ? pendingDraft : null;
}
