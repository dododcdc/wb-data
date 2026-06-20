import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatLocalDateTime } from '../lib/dateTime';
import { TimeRangePicker } from './TimeRangePicker';

class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
}

describe('TimeRangePicker', () => {
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

    function renderPicker(overrides?: Partial<React.ComponentProps<typeof TimeRangePicker>>) {
        const onChange = vi.fn();
        render(
            <TimeRangePicker
                from="2025-12-28 08:30:00"
                to="2026-01-03 18:45:30"
                onChange={onChange}
                {...overrides}
            />
        );
        return { onChange };
    }

    function openPicker() {
        fireEvent.click(screen.getByRole('button', { name: /时间范围.*2025-12-28 08:30:00.*2026-01-03 18:45:30/ }));
    }

    it('shows the applied range, browser timezone, and exact draft summary', async () => {
        renderPicker();

        openPicker();

        expect(await screen.findByText('选择时间范围')).toBeTruthy();
        expect(screen.getByText(/浏览器时区/)).toBeTruthy();
        expect(screen.getAllByText('2025-12-28 08:30:00').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-01-03 18:45:30').length).toBeGreaterThan(0);
        expect(screen.getByText('6天 10小时 15分 30秒')).toBeTruthy();
    });

    it('keeps presets as draft values until Apply', async () => {
        const now = new Date(2026, 5, 20, 12, 0, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
        const { onChange } = renderPicker();
        openPicker();

        fireEvent.click(await screen.findByRole('button', { name: '最近 7 天' }));

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText(formatLocalDateTime(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)))).toBeTruthy();
        expect(screen.getByText(formatLocalDateTime(now))).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '应用' }));
        expect(onChange).toHaveBeenCalledWith(
            formatLocalDateTime(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
            formatLocalDateTime(now),
        );
    });

    it('discards preset changes on Cancel and Escape', async () => {
        const { onChange } = renderPicker();
        openPicker();
        fireEvent.click(await screen.findByRole('button', { name: '最近 30 天' }));
        fireEvent.click(screen.getByRole('button', { name: '取消' }));

        expect(onChange).not.toHaveBeenCalled();
        openPicker();
        expect(await screen.findByText('选择时间范围')).toBeTruthy();
        expect(screen.getAllByText('2025-12-28 08:30:00').length).toBeGreaterThan(0);

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByText('选择时间范围')).toBeNull());
        expect(onChange).not.toHaveBeenCalled();
    });

    it('jumps directly to a historical year and month', async () => {
        renderPicker();
        openPicker();

        const year = await screen.findByLabelText('年份') as HTMLSelectElement;
        const month = screen.getByLabelText('月份') as HTMLSelectElement;
        fireEvent.change(year, { target: { value: '2024' } });
        fireEvent.change(month, { target: { value: '0' } });

        expect(year.value).toBe('2024');
        expect(month.value).toBe('0');
        expect(screen.getByText('2024年1月')).toBeTruthy();
    });

    it('starts a new custom range and requires an end date', async () => {
        renderPicker();
        openPicker();

        const day15 = (await screen.findAllByRole('gridcell')).find((cell) => cell.textContent === '15');
        expect(day15).toBeTruthy();
        fireEvent.click(day15!);

        expect(screen.getByText('请选择结束日期')).toBeTruthy();
        expect(screen.getByRole('button', { name: '应用' }).hasAttribute('disabled')).toBe(true);
    });

    it('supports direct and arrow-key edits for time segments', async () => {
        const { onChange } = renderPicker();
        openPicker();

        const startHour = await screen.findByLabelText('开始小时') as HTMLInputElement;
        fireEvent.change(startHour, { target: { value: '09' } });
        fireEvent.keyDown(startHour, { key: 'ArrowUp' });
        fireEvent.click(screen.getByRole('button', { name: '应用' }));

        expect(onChange).toHaveBeenCalledWith('2025-12-28 10:30:00', '2026-01-03 18:45:30');
    });

    it('shows an inline error and disables Apply for a reversed timestamp range', async () => {
        renderPicker({
            from: '2026-01-02 08:00:00',
            to: '2026-01-02 18:00:00',
        });
        fireEvent.click(screen.getByRole('button', { name: /时间范围.*2026-01-02 08:00:00.*2026-01-02 18:00:00/ }));

        fireEvent.change(await screen.findByLabelText('开始小时'), { target: { value: '20' } });

        expect(screen.getByText('开始时间不能晚于结束时间')).toBeTruthy();
        expect(screen.getByRole('button', { name: '应用' }).hasAttribute('disabled')).toBe(true);
    });
});
