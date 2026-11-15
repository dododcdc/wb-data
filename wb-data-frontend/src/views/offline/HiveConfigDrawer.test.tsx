import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { HiveConfigDrawer } from './HiveConfigDrawer';

afterEach(() => cleanup());

describe('HiveConfigDrawer', () => {
    it('collapses presets by default, expands on click, and adds presets without duplicates', () => {
        const onChange = vi.fn();
        render(
            <TooltipProvider delayDuration={0}>
                <HiveConfigDrawer
                    nodeKey="hive_1"
                    value={undefined}
                    onChange={onChange}
                    onClose={vi.fn()}
                />
            </TooltipProvider>,
        );

        const presetsToggle = screen.getByTestId('hive-conf-presets-toggle');
        expect(presetsToggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('hive-conf-preset-list')).toBeNull();
        expect(screen.queryByRole('button', { name: /开启动态分区/i })).toBeNull();

        fireEvent.click(presetsToggle);
        expect(presetsToggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('hive-conf-preset-list')).toBeTruthy();

        const dynamicPartitionPreset = screen.getByRole('button', { name: /开启动态分区/i });
        expect(dynamicPartitionPreset.getAttribute('title')).toBeNull();
        fireEvent.click(dynamicPartitionPreset);
        expect(onChange).toHaveBeenLastCalledWith({
            'hive.exec.dynamic.partition': 'true',
        });
        expect((dynamicPartitionPreset as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('hive-conf-active-count').textContent).toBe('1');

        fireEvent.click(presetsToggle);
        expect(presetsToggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('hive-conf-preset-list')).toBeNull();
    });

    it('supports adding custom parameters, inline validation errors, and clearing all parameters', () => {
        const onChange = vi.fn();
        render(
            <TooltipProvider delayDuration={0}>
                <HiveConfigDrawer
                    nodeKey="hive_1"
                    value={{ 'hive.merge.mapfiles': 'true' }}
                    onChange={onChange}
                    onClose={vi.fn()}
                />
            </TooltipProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: /添加参数/i }));
        const keyInput2 = screen.getByLabelText('参数名 2') as HTMLInputElement;
        const valInput2 = screen.getByLabelText('参数值 2') as HTMLInputElement;

        fireEvent.change(keyInput2, { target: { value: 'invalid key' } });
        expect(screen.getByRole('alert').textContent).toContain('仅支持');
        // Invalid key must not be emitted
        expect(onChange).not.toHaveBeenCalled();

        // Fixing key emits both pairs
        fireEvent.change(keyInput2, { target: { value: 'mapreduce.job.name' } });
        fireEvent.change(valInput2, { target: { value: 'daily_etl' } });
        expect(onChange).toHaveBeenLastCalledWith({
            'hive.merge.mapfiles': 'true',
            'mapreduce.job.name': 'daily_etl',
        });

        // Duplicate key warns and keeps row editable without duplicate backend keys
        fireEvent.change(keyInput2, { target: { value: 'hive.merge.mapfiles' } });
        expect(screen.getAllByRole('alert').some((el) => el.textContent?.includes('重复'))).toBe(true);

        // Clear all resets to undefined
        fireEvent.click(screen.getByRole('button', { name: /清空/i }));
        expect(onChange).toHaveBeenLastCalledWith(undefined);
    });

    it('renders read-only Hive configuration without presets, add/remove controls, or mutations', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <TooltipProvider delayDuration={0}>
                <HiveConfigDrawer
                    nodeKey="hive_ro"
                    value={{ 'hive.exec.dynamic.partition': 'true' }}
                    readOnly
                    onChange={onChange}
                    onClose={vi.fn()}
                />
            </TooltipProvider>,
        );

        expect(screen.queryByTestId('hive-conf-presets-toggle')).toBeNull();
        expect(screen.queryByRole('button', { name: /添加参数/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /清空/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /删除参数/i })).toBeNull();

        const keyInput = screen.getByLabelText('参数名 1') as HTMLInputElement;
        const valInput = screen.getByLabelText('参数值 1') as HTMLInputElement;
        expect(keyInput.readOnly).toBe(true);
        expect(valInput.readOnly).toBe(true);

        rerender(
            <TooltipProvider delayDuration={0}>
                <HiveConfigDrawer
                    nodeKey="hive_ro"
                    value={undefined}
                    readOnly
                    onChange={onChange}
                    onClose={vi.fn()}
                />
            </TooltipProvider>,
        );
        expect(screen.getByText('当前线上版本未配置 Hive 运行参数。')).toBeTruthy();
        expect(onChange).not.toHaveBeenCalled();
    });
});
