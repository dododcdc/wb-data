import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SearchableCombobox, type SearchableComboboxOption } from './SearchableCombobox';

const mockOptions: SearchableComboboxOption[] = [
    {
        value: '1',
        label: '日常时间公共变量',
        subLabel: 'daily_time_vars',
        badge: 'v1',
        count: 8,
        description: '提供通用的日期与时间宏变量',
        keywords: ['daily_time_vars', '日常时间公共变量', 'v_today', 'v_yesterday'],
    },
    {
        value: '2',
        label: '业务核心常量与维度配置',
        subLabel: 'biz_core_config',
        badge: 'v2',
        count: 10,
        description: '数仓分层常量与核心枚举值',
        keywords: ['biz_core_config', '业务核心常量', 'dw_ods_schema'],
    },
    {
        value: '3',
        label: '风控引擎与安全指标',
        subLabel: 'risk_engine_thresholds',
        badge: 'v1',
        count: 15,
        description: '风控报警与阈值参数',
        keywords: ['risk_engine_thresholds', '风控引擎', 'max_single_trade'],
    },
];

describe('SearchableCombobox', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the placeholder on the input', () => {
        render(
            <SearchableCombobox
                options={mockOptions}
                placeholder="请选择参数组..."
                onChange={vi.fn()}
            />
        );

        expect(screen.getByPlaceholderText('请选择参数组...')).toBeTruthy();
    });

    it('opens popover on focus/type and filters options based on query', async () => {
        const handleChange = vi.fn();
        render(
            <SearchableCombobox
                options={mockOptions}
                placeholder="请选择参数组..."
                onChange={handleChange}
            />
        );

        const input = screen.getByPlaceholderText('请选择参数组...');
        fireEvent.focus(input);

        // All 3 options visible initially
        expect(screen.getByText('日常时间公共变量')).toBeTruthy();
        expect(screen.getByText('业务核心常量与维度配置')).toBeTruthy();
        expect(screen.getByText('风控引擎与安全指标')).toBeTruthy();

        // Type query 'risk'
        fireEvent.change(input, { target: { value: 'risk' } });

        // Filtered: only risk option is visible
        expect(screen.queryByText('日常时间公共变量')).toBeNull();
        expect(screen.getByText('风控引擎与安全指标')).toBeTruthy();
        expect(screen.getByText('找到 1 个匹配项')).toBeTruthy();

        // Click the filtered option
        fireEvent.click(screen.getByText('风控引擎与安全指标'));

        expect(handleChange).toHaveBeenCalledWith('3', expect.objectContaining({ value: '3', label: '风控引擎与安全指标' }));
    });

    it('shows empty text when no matching options are found', async () => {
        render(
            <SearchableCombobox
                options={mockOptions}
                placeholder="请选择参数组..."
                emptyText="没有匹配的参数组"
                onChange={vi.fn()}
            />
        );

        const input = screen.getByPlaceholderText('请选择参数组...');
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'nonexistent_query_xyz' } });

        expect(screen.getByText('没有匹配的参数组')).toBeTruthy();
    });

    it('supports keyboard navigation (ArrowDown, ArrowUp, Enter)', async () => {
        const handleChange = vi.fn();
        render(
            <SearchableCombobox
                options={mockOptions}
                placeholder="请选择参数组..."
                onChange={handleChange}
            />
        );

        const input = screen.getByPlaceholderText('请选择参数组...');
        fireEvent.focus(input);

        // Press ArrowDown to navigate to index 1 (业务核心常量与维度配置)
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        // Press Enter to select
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(handleChange).toHaveBeenCalledWith('2', expect.objectContaining({ value: '2', label: '业务核心常量与维度配置' }));
    });

    it('opens and stays open on first click without flashing closed', async () => {
        render(
            <SearchableCombobox
                options={mockOptions}
                placeholder="请选择参数组..."
                onChange={vi.fn()}
            />
        );

        const input = screen.getByPlaceholderText('请选择参数组...');
        // Simulating the user's first click: focus followed by click
        fireEvent.focus(input);
        fireEvent.click(input);

        // Options must remain open and visible
        expect(screen.getByText('日常时间公共变量')).toBeTruthy();
        expect(screen.getByText('业务核心常量与维度配置')).toBeTruthy();

        // Clicking outside closes the popover
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('日常时间公共变量')).toBeNull();
    });

    it('clears query when clicking the clear button', async () => {
        render(
            <SearchableCombobox
                options={mockOptions}
                placeholder="请选择参数组..."
                onChange={vi.fn()}
            />
        );

        const input = screen.getByPlaceholderText('请选择参数组...') as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'risk' } });
        expect(input.value).toBe('risk');

        // Find the clear button
        const clearButton = input.parentElement?.querySelector('button[type="button"]');
        expect(clearButton).toBeTruthy();
        fireEvent.click(clearButton!);

        expect(input.value).toBe('');
    });

    it('handles Chinese IME composition without premature filtering', async () => {
        render(
            <SearchableCombobox
                options={mockOptions}
                placeholder="请选择参数组..."
                onChange={vi.fn()}
            />
        );

        const input = screen.getByPlaceholderText('请选择参数组...') as HTMLInputElement;
        fireEvent.focus(input);

        // 1. IME Composition starts (user begins typing pinyin 'fengkong')
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: 'fengkong' } });

        // During composition, all options should still be displayed (no premature filtering on unconfirmed pinyin)
        expect(screen.getByText('日常时间公共变量')).toBeTruthy();
        expect(screen.getByText('业务核心常量与维度配置')).toBeTruthy();
        expect(screen.getByText('风控引擎与安全指标')).toBeTruthy();

        // Pressing Enter during IME composition should NOT trigger combobox selection
        fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });

        // 2. IME Composition ends with confirmed Chinese character '风控'
        fireEvent.change(input, { target: { value: '风控' } });
        fireEvent.compositionEnd(input, { target: { value: '风控' } });

        // Now filtering takes effect
        expect(screen.queryByText('日常时间公共变量')).toBeNull();
        expect(screen.getByText('风控引擎与安全指标')).toBeTruthy();
        expect(screen.getByText('找到 1 个匹配项')).toBeTruthy();
    });
});
