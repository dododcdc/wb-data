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

    it('keeps the quick-range timestamps together as one centered group', async () => {
        render(
            <OperationsTimeFilter
                from="2026-06-20 09:53:45"
                to="2026-06-21 09:53:45"
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /2026-06-20 09:53:45/ }));

        await screen.findByLabelText('待应用时间范围');
        expect(screen.getByRole('group', { name: '开始和结束时间' })).toBeTruthy();
    });

    it('shows two consecutive months for a December to January range', async () => {
        render(
            <OperationsTimeFilter
                from="2025-12-28 08:30:00"
                to="2026-01-03 18:45:30"
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /2025-12-28 08:30:00/ }));
        fireEvent.click(await screen.findByRole('tab', { name: '自定义范围' }));

        expect(screen.getByText('2025年12月')).toBeTruthy();
        expect(screen.getByText('2026年1月')).toBeTruthy();
        expect(screen.getAllByRole('grid')).toHaveLength(2);
    });

    it('applies directly entered second-precision values', async () => {
        const onChange = vi.fn();
        render(
            <OperationsTimeFilter
                from="2026-01-01 00:00:00"
                to="2026-01-02 00:00:00"
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /2026-01-01 00:00:00/ }));
        fireEvent.click(await screen.findByRole('tab', { name: '自定义范围' }));
        fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-12-31' } });
        fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '23:59:58' } });
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        expect(onChange).toHaveBeenCalledWith('2025-12-31 23:59:58', '2026-01-02 00:00:00');
    });

    it('rejects a start timestamp later than the end timestamp', async () => {
        render(
            <OperationsTimeFilter
                from="2026-01-01 08:00:00"
                to="2026-01-01 18:00:00"
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /2026-01-01 08:00:00/ }));
        fireEvent.click(await screen.findByRole('tab', { name: '自定义范围' }));
        fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '20:00:00' } });

        expect(screen.getByText('开始时间不能晚于结束时间')).toBeTruthy();
        expect(screen.getByRole('button', { name: '应用' }).hasAttribute('disabled')).toBe(true);
    });

    it('uses a single calendar month on a narrow viewport', async () => {
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
            matches: query === '(max-width: 720px)',
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })));
        render(
            <OperationsTimeFilter
                from="2025-12-28 08:30:00"
                to="2026-01-03 18:45:30"
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /2025-12-28 08:30:00/ }));
        fireEvent.click(await screen.findByRole('tab', { name: '自定义范围' }));

        expect(screen.getAllByRole('grid')).toHaveLength(1);
    });
});
