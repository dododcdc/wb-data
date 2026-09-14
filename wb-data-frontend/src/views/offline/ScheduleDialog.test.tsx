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
        timezone: 'Asia/Shanghai',
        saving: false,
        flowId: 'example',
        hasRemote: true,
        hasLocalOrUnpushedChanges: false,
        onOpenChange: vi.fn(),
        onCronChange: vi.fn(),
        onSave: vi.fn(),
        onToggle: vi.fn(),
        ...overrides,
    };
    return { ...render(<ScheduleDialog {...props} />), props };
}

describe('ScheduleDialog', () => {
    it('shows draft/push hint beside the switch', () => {
        renderDialog();
        expect(screen.getByText('开或关都只写入草稿；推送到远程后才会真正生效')).toBeTruthy();
    });

    it('alerts when Git remote is not configured without disabling the switch', () => {
        renderDialog({ hasRemote: false });
        expect(screen.getByText('尚未配置 Git 远程')).toBeTruthy();
        const toggle = screen.getByRole('switch', { name: '启用调度' }) as HTMLButtonElement;
        expect(toggle.disabled).toBe(false);
    });

    it('alerts when there are local or unpushed changes', () => {
        renderDialog({ hasLocalOrUnpushedChanges: true });
        expect(screen.getByText('有未推送或本地变更，界面调度可能与远程不一致')).toBeTruthy();
    });

    it('disables enabling and staging when cron is invalid', () => {
        const { props } = renderDialog({ cron: '99 99 99 99 99' });
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
            schedule: makeSchedule({ enabled: true, cron: 'not-a-cron' }),
        });
        const toggle = screen.getByRole('switch', { name: '启用调度' }) as HTMLButtonElement;
        expect(toggle.disabled).toBe(false);
        fireEvent.click(toggle);
        expect(props.onToggle).toHaveBeenCalledWith(false);
    });
});
