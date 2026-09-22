import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleDialog } from './ScheduleDialog';
import type { OfflineScheduleResponse } from '../../api/offline';

function makeSchedule(overrides: Partial<OfflineScheduleResponse> = {}): OfflineScheduleResponse {
    return {
        groupId: 1,
        path: '_flows/example/flow.yaml',
        triggerId: 'schedule',
        cron: '0 2 * * *',
        timezone: 'Asia/Shanghai',
        enabled: false,
        period: 'DAILY',
        contentHash: 'hash',
        fileUpdatedAt: 1,
        ...overrides,
    };
}

function renderDialog(overrides: Partial<ComponentProps<typeof ScheduleDialog>> = {}) {
    const props = {
        open: true,
        schedule: makeSchedule(),
        cron: '0 2 * * *',
        period: 'DAILY' as const,
        timezone: 'Asia/Shanghai',
        saving: false,
        flowId: 'example',
        hasRemote: true,
        hasLocalOrUnpushedChanges: false,
        onOpenChange: vi.fn(),
        onPeriodChange: vi.fn(),
        onSave: vi.fn(),
        onToggle: vi.fn(),
        ...overrides,
    };
    return { ...render(<ScheduleDialog {...props} />), props };
}

describe('ScheduleDialog', () => {
    it('places publishing guidance with the staging action and shows the timezone only once', () => {
        renderDialog();
        const save = screen.getByRole('button', { name: '暂存配置' });
        const footer = save.closest('.offline-schedule-footer') as HTMLElement;
        expect(within(footer).getByText('暂存后自动保存草稿，提交并推送、同步成功后生效')).toBeTruthy();
        expect(screen.getAllByText(/Asia\/Shanghai/)).toHaveLength(1);
        expect(screen.queryByText('核心设置')).toBeNull();
    });

    it('shows the missing remote warning without disabling editing or duplicating drift warnings', () => {
        renderDialog({ hasRemote: false, hasLocalOrUnpushedChanges: true });
        expect(screen.getByRole('status').textContent).toContain('尚未配置 Git 远程，暂时无法发布调度');
        expect(screen.queryByText('存在本地或未推送变更，线上配置可能不同')).toBeNull();
        const toggle = screen.getByRole('switch', { name: '启用调度' }) as HTMLButtonElement;
        expect(toggle.disabled).toBe(false);
    });

    it('shows a compact status when there are local or unpushed changes', () => {
        renderDialog({ hasLocalOrUnpushedChanges: true });
        expect(screen.getByRole('status').textContent).toContain('存在本地或未推送变更，线上配置可能不同');
    });

    it('offers all five periods as radio options and emits the selected period', () => {
        const { props } = renderDialog();
        const group = screen.getByRole('group', { name: '调度频率' });
        expect(within(group).getAllByRole('radio')).toHaveLength(5);
        expect((within(group).getByRole('radio', { name: '每天' }) as HTMLInputElement).checked).toBe(true);
        fireEvent.click(within(group).getByRole('radio', { name: '每周' }));
        expect(props.onPeriodChange).toHaveBeenCalledWith('WEEKLY');
    });

    it('starts with three preview times and expands or collapses without changing the schedule', () => {
        const { props } = renderDialog();
        const preview = screen.getByRole('region', { name: '按当前配置预览' });
        expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
        const expand = within(preview).getByRole('button', { name: '展开更多' });
        expect(expand.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(expand);
        expect(within(preview).getAllByRole('listitem')).toHaveLength(5);
        expect(expand.getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(within(preview).getByRole('button', { name: '收起' }));
        expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
        expect(props.onPeriodChange).not.toHaveBeenCalled();
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('resets the preview to three times when reopened', () => {
        const { props, rerender } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: '展开更多' }));
        rerender(<ScheduleDialog {...props} open={false} />);
        rerender(<ScheduleDialog {...props} open />);
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('disables period and time controls while staging', () => {
        renderDialog({ saving: true });
        for (const control of [...screen.getAllByRole('radio'), ...screen.getAllByRole('combobox')]) {
            expect(control.matches(':disabled')).toBe(true);
        }
    });

    it('disables enabling and staging when cron is invalid', () => {
        const { props } = renderDialog({ cron: '99 99 99 99 99', period: 'CUSTOM' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        expect(within(dialog).getByText('无效的 Cron 表达式')).toBeTruthy();
        expect((within(dialog).getByRole('switch', { name: '启用调度' }) as HTMLButtonElement).disabled).toBe(true);
        expect((within(dialog).getByRole('button', { name: '暂存配置' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(within(dialog).getByRole('switch', { name: '启用调度' }));
        expect(props.onToggle).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: '暂存配置' }));
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('still allows turning schedule off when cron is invalid', () => {
        const { props } = renderDialog({
            cron: 'not-a-cron',
            period: 'CUSTOM',
            schedule: makeSchedule({ enabled: true, cron: 'not-a-cron', period: 'CUSTOM' }),
        });
        const toggle = screen.getByRole('switch', { name: '启用调度' }) as HTMLButtonElement;
        expect(toggle.disabled).toBe(false);
        fireEvent.click(toggle);
        expect(props.onToggle).toHaveBeenCalledWith(false);
    });

    it('shows period time fields for standard periods', () => {
        renderDialog({ period: 'DAILY', cron: '30 6 * * *' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        expect(within(dialog).getByText('计划时间')).toBeTruthy();
        expect((within(dialog).getByRole('combobox', { name: '小时' }) as HTMLElement).textContent).toContain('6');
        expect((within(dialog).getByRole('combobox', { name: '分钟' }) as HTMLElement).textContent).toContain('30');
    });

    it('shows the weekday field for the weekly period', () => {
        renderDialog({ period: 'WEEKLY', cron: '30 6 * * 5' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        expect((within(dialog).getByRole('combobox', { name: '星期几' }) as HTMLElement).textContent).toContain('周五');
        expect(within(dialog).queryByRole('combobox', { name: '第几日' })).toBeNull();
    });

    it('shows month and day fields for the yearly period', () => {
        renderDialog({ period: 'YEARLY', cron: '0 0 1 10 *' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        expect((within(dialog).getByRole('combobox', { name: '月份' }) as HTMLElement).textContent).toContain('10');
        expect((within(dialog).getByRole('combobox', { name: '第几日' }) as HTMLElement).textContent).toContain('1');
    });

    it('warns and blocks staging for legacy non-standard crons until a standard period is chosen', () => {
        const { props } = renderDialog({ period: 'CUSTOM', cron: '0 1,8,13 * * *' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        expect(within(dialog).getByText(/非标准 Cron 表达式/)).toBeTruthy();
        expect(within(dialog).getAllByRole('radio').some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
        expect((within(dialog).getByRole('button', { name: '暂存配置' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(within(dialog).getByRole('button', { name: '暂存配置' }));
        expect(props.onSave).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('radio', { name: '每天' }));
        expect(props.onPeriodChange).toHaveBeenCalledWith('DAILY');
    });

    it('standardizes a legacy custom cron when a time part changes', async () => {
        const { props } = renderDialog({ period: 'CUSTOM', cron: '0 1,8,13 * * *' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        fireEvent.click(within(dialog).getByRole('combobox', { name: '小时' }));
        const option = await screen.findByRole('option', { name: '7时' });
        fireEvent.mouseMove(option);
        fireEvent.click(option);
        expect(props.onPeriodChange).toHaveBeenCalledWith('DAILY', {
            minute: 0,
            hour: 7,
            dayOfMonth: 1,
            dayOfWeek: 1,
            month: 1,
        });
    });

    it('emits updated parts when a time part changes', async () => {
        const { props } = renderDialog({ period: 'DAILY', cron: '30 6 * * *' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        fireEvent.click(within(dialog).getByRole('combobox', { name: '小时' }));
        const option = await screen.findByRole('option', { name: '7时' });
        fireEvent.mouseMove(option);
        fireEvent.click(option);
        expect(props.onPeriodChange).toHaveBeenCalledWith('DAILY', {
            minute: 30,
            hour: 7,
            dayOfMonth: 1,
            dayOfWeek: 1,
            month: 1,
        });
    });

    it('emits the selected weekday for the weekly period', async () => {
        const { props } = renderDialog({ period: 'WEEKLY', cron: '30 6 * * 5' });
        const dialog = screen.getByRole('dialog', { name: '调度配置' });
        fireEvent.click(within(dialog).getByRole('combobox', { name: '星期几' }));
        const option = await screen.findByRole('option', { name: '周日' });
        fireEvent.mouseMove(option);
        fireEvent.click(option);
        expect(props.onPeriodChange).toHaveBeenCalledWith('WEEKLY', {
            minute: 30,
            hour: 6,
            dayOfMonth: 1,
            dayOfWeek: 7,
            month: 1,
        });
    });
});
