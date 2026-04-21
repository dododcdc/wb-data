import { describe, expect, it, vi } from 'vitest';

import type { PendingNodeEditorDraft } from './flowDraftController';
import { finalizeNodeEditorDraftOnClose } from './nodeEditorCloseDraftState';

describe('finalizeNodeEditorDraftOnClose', () => {
    it('flushes the pending draft before closing the editor', () => {
        const pendingDraft: PendingNodeEditorDraft = {
            taskId: 'node-a',
            scriptContent: 'select 2',
        };
        const flushNow = vi.fn();
        const cancel = vi.fn();

        expect(finalizeNodeEditorDraftOnClose({
            pendingDraft,
            flushNow,
            cancel,
        })).toBeNull();
        expect(flushNow).toHaveBeenCalledWith(pendingDraft);
        expect(cancel).not.toHaveBeenCalled();
    });

    it('cancels the scheduler when there is no pending draft to flush', () => {
        const flushNow = vi.fn();
        const cancel = vi.fn();

        expect(finalizeNodeEditorDraftOnClose({
            pendingDraft: null,
            flushNow,
            cancel,
        })).toBeNull();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(flushNow).not.toHaveBeenCalled();
    });
});
