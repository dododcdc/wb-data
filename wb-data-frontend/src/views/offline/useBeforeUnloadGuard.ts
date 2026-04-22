import { useEffect } from 'react';

/**
 * Registers a beforeunload listener that shows the browser's "leave page?" dialog
 * when isDirty is true, preventing accidental data loss on tab close or refresh.
 */
export function useBeforeUnloadGuard(isDirty: boolean) {
    useEffect(() => {
        if (!isDirty) return;

        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);
}
