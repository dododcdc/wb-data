import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OperationsTimeFilter } from './OperationsTimeFilter';

class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
}

describe('OperationsTimeFilter', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })));
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('shows the exact applied range and keeps presets as drafts until Apply', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 5, 21, 12, 0, 0).getTime());
        const onChange = vi.fn();
        render(
            <OperationsTimeFilter
                from="2025-12-28 08:30:00"
                to="2026-01-03 18:45:30"
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /2025-12-28 08:30:00.*2026-01-03 18:45:30/ }));
        fireEvent.click(await screen.findByRole('button', { name: '最近 7 天' }));

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText('2026-06-14 12:00:00')).toBeTruthy();
        expect(screen.getByText('2026-06-21 12:00:00')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '应用' }));
        expect(onChange).toHaveBeenCalledWith('2026-06-14 12:00:00', '2026-06-21 12:00:00');
    });
});
