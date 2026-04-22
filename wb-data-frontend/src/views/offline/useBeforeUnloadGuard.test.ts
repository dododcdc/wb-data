import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

it('calls event.preventDefault when isDirty is true', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useBeforeUnloadGuard(true));

    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const handler = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === 'beforeunload')?.[1] as EventListener;
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    handler(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
});

it('does not register a beforeunload listener when isDirty is false', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useBeforeUnloadGuard(false));

    expect(addEventListenerSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
});

it('removes the listener when isDirty becomes false', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { rerender } = renderHook(({ isDirty }) => useBeforeUnloadGuard(isDirty), {
        initialProps: { isDirty: true },
    });

    const handler = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === 'beforeunload')?.[1] as EventListener;
    rerender({ isDirty: false });

    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', handler);
});
