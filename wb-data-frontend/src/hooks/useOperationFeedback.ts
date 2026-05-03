import { useCallback } from 'react';
import { create } from 'zustand';
import { FEEDBACK_DURATION } from '../constants/feedback';
import { getErrorMessage } from '../utils/error';

export type FeedbackTone = 'success' | 'error' | 'info';

export interface FeedbackPayload {
    tone: FeedbackTone;
    title: string;
    detail: string;
}

interface FeedbackState {
    current: FeedbackPayload | null;
    timerId: number | null;
    show: (payload: FeedbackPayload, durationMs?: number) => void;
    dismiss: () => void;
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
    current: null,
    timerId: null,

    show: (payload, durationMs) => {
        const prev = get().timerId;
        if (prev != null) window.clearTimeout(prev);

        const ms = durationMs ?? FEEDBACK_DURATION[payload.tone];

        const id = window.setTimeout(() => {
            set({ current: null, timerId: null });
        }, ms);

        set({ current: payload, timerId: id });
    },

    dismiss: () => {
        const prev = get().timerId;
        if (prev != null) window.clearTimeout(prev);
        set({ current: null, timerId: null });
    },
}));

export function useOperationFeedback() {
    const show = useFeedbackStore((s) => s.show);
    const dismiss = useFeedbackStore((s) => s.dismiss);

    const showSuccess = useCallback((title: string, detail?: string) => {
        show({ tone: 'success', title, detail: detail ?? '' });
    }, [show]);

    const showError = useCallback((error: unknown, title: string) => {
        show({
            tone: 'error',
            title,
            detail: getErrorMessage(error, title),
        });
    }, [show]);

    return { showFeedback: show, dismissFeedback: dismiss, showSuccess, showError };
}
