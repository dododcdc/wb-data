import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimePicker } from './DateTimePicker';

describe('DateTimePicker', () => {
    afterEach(() => {
        cleanup();
    });
    it('renders the formatted date value and timezone badge', () => {
        render(
            <DateTimePicker
                value="2026-08-18T14:30"
                timezone="Asia/Shanghai"
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByText('2026-08-18 14:30')).toBeTruthy();
        expect(screen.getByText('Asia/Shanghai')).toBeTruthy();
    });

    it('renders placeholder when value is empty', () => {
        render(
            <DateTimePicker
                value=""
                placeholder="请选择计划时间"
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByText('请选择计划时间')).toBeTruthy();
    });

    it('opens popover and triggers onChange when clicking a preset button', async () => {
        const onChange = vi.fn();
        render(
            <DateTimePicker
                value="2026-08-18T10:00"
                timezone="Asia/Shanghai"
                onChange={onChange}
            />,
        );

        // Click trigger to open popover
        fireEvent.click(screen.getByRole('button', { name: '选择计划时间' }));

        // Click preset button
        const presetBtn = await screen.findByRole('button', { name: '今天 00:00' });
        fireEvent.click(presetBtn);

        expect(onChange).toHaveBeenCalled();
        const arg = onChange.mock.calls[0][0];
        expect(arg).toMatch(/^\d{4}-\d{2}-\d{2}T00:00$/);
    });
});
