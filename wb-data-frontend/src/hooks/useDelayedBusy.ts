import { useEffect, useRef, useState } from 'react';

interface UseDelayedBusyOptions {
    delayMs?: number;
    minVisibleMs?: number;
}

export function useDelayedBusy(
    active: boolean,
    options: UseDelayedBusyOptions = {},
) {
    const { delayMs = 140, minVisibleMs = 320 } = options;
    const [visible, setVisible] = useState(false);
    const visibleSinceRef = useRef<number | null>(null);
    const showTimerRef = useRef<number | null>(null);
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (showTimerRef.current !== null) {
                window.clearTimeout(showTimerRef.current);
            }
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (showTimerRef.current !== null) {
            window.clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
        }

        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }

        if (active) {
            if (visible) return;

            showTimerRef.current = window.setTimeout(() => {
                visibleSinceRef.current = performance.now();
                setVisible(true);
                showTimerRef.current = null;
            }, delayMs);

            return;
        }

        if (!visible) {
            visibleSinceRef.current = null;
            return;
        }

        const visibleFor = visibleSinceRef.current === null
            ? minVisibleMs
            : performance.now() - visibleSinceRef.current;
        const remaining = Math.max(minVisibleMs - visibleFor, 0);

        hideTimerRef.current = window.setTimeout(() => {
            visibleSinceRef.current = null;
            setVisible(false);
            hideTimerRef.current = null;
        }, remaining);
    }, [active, delayMs, minVisibleMs, visible]);

    return visible;
}
