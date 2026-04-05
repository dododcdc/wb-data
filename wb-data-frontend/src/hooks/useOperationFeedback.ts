import { create } from 'zustand';

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

const DEFAULT_DURATION = 3600;

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
    current: null,
    timerId: null,

    show: (payload, durationMs = DEFAULT_DURATION) => {
        const prev = get().timerId;
        if (prev != null) window.clearTimeout(prev);

        const id = window.setTimeout(() => {
            set({ current: null, timerId: null });
        }, durationMs);

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
    return { showFeedback: show, dismissFeedback: dismiss };
}
