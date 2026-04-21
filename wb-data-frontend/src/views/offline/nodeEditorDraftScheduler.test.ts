import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNodeEditorDraftScheduler } from './nodeEditorDraftScheduler';

describe('createNodeEditorDraftScheduler', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces repeated draft updates and flushes only the latest payload', () => {
        const flush = vi.fn();
        const scheduler = createNodeEditorDraftScheduler({
            delayMs: 120,
            onFlush: flush,
        });

        scheduler.schedule({ taskId: 'a', scriptContent: 'select 1' });
        vi.advanceTimersByTime(60);
        scheduler.schedule({ taskId: 'a', scriptContent: 'select 2' });
        vi.advanceTimersByTime(119);

        expect(flush).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);

        expect(flush).toHaveBeenCalledTimes(1);
        expect(flush).toHaveBeenCalledWith({
            taskId: 'a',
            scriptContent: 'select 2',
        });
    });

    it('flushes immediately and cancels any pending debounce timer', () => {
        const flush = vi.fn();
        const scheduler = createNodeEditorDraftScheduler({
            delayMs: 120,
            onFlush: flush,
        });

        scheduler.schedule({ taskId: 'a', scriptContent: 'select delayed' });
        scheduler.flushNow({ taskId: 'a', scriptContent: 'select now' });

        expect(flush).toHaveBeenCalledTimes(1);
        expect(flush).toHaveBeenCalledWith({
            taskId: 'a',
            scriptContent: 'select now',
        });

        vi.runAllTimers();

        expect(flush).toHaveBeenCalledTimes(1);
    });
});
