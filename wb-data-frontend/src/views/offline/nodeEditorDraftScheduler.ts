import type { PendingNodeEditorDraft } from './flowDraftController';

interface CreateNodeEditorDraftSchedulerParams {
    delayMs: number;
    onFlush: (draft: PendingNodeEditorDraft) => void;
}

export function createNodeEditorDraftScheduler(params: CreateNodeEditorDraftSchedulerParams) {
    const { delayMs, onFlush } = params;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return {
        schedule(draft: PendingNodeEditorDraft) {
            clearTimer();
            timer = setTimeout(() => {
                timer = null;
                onFlush(draft);
            }, delayMs);
        },
        flushNow(draft: PendingNodeEditorDraft) {
            clearTimer();
            onFlush(draft);
        },
        cancel() {
            clearTimer();
        },
    };
}
