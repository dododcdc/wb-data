import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOfflineDependents, type OfflineDependentItem, type OfflineFlowDependencySettings } from '../../api/offline';
import { DependencyAwareScheduleDialog, type DependencyAwareScheduleDialogProps } from './DependencyAwareScheduleDialog';
import { ScheduleDialog } from './ScheduleDialog';

type DialogContract = ComponentProps<typeof ScheduleDialog>;

vi.mock('../../api/offline', () => ({ getOfflineDependents: vi.fn() }));
vi.mock('./ScheduleDialog', () => ({
    ScheduleDialog: vi.fn((props: DialogContract) => props.open ? <div>{props.dependencyNotice}</div> : null),
}));

const dependent: OfflineDependentItem = {
    groupId: 2,
    groupName: '数据分析',
    flowId: 'daily_report',
    path: '_flows/daily_report/flow.yaml',
};
const upstream: OfflineFlowDependencySettings = {
    dependencies: [{ groupId: 3, flowId: 'source' }],
    failurePolicy: 'CONTINUE',
    crossGroupDependency: 'ALLOW',
};
const parts = { minute: 30, hour: 7, dayOfMonth: 1, dayOfWeek: 1, month: 1 };

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function currentDialog(): DialogContract {
    return vi.mocked(ScheduleDialog).mock.lastCall![0];
}

function renderDialog(overrides: Partial<DependencyAwareScheduleDialogProps> = {}) {
    const props: DependencyAwareScheduleDialogProps = {
        groupId: 1,
        path: '_flows/example/flow.yaml',
        open: true,
        schedule: {
            groupId: 1, path: '_flows/example/flow.yaml', triggerId: 'schedule',
            cron: '30 6 * * *', period: 'DAILY', timezone: 'Asia/Shanghai',
            enabled: false, contentHash: 'hash', fileUpdatedAt: 1,
        },
        cron: '30 6 * * *',
        period: 'DAILY',
        timezone: 'Asia/Shanghai',
        saving: false,
        flowId: 'example',
        hasRemote: false,
        hasLocalOrUnpushedChanges: true,
        onOpenChange: vi.fn(),
        onPeriodChange: vi.fn(),
        onSave: vi.fn(),
        onToggle: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<DependencyAwareScheduleDialog {...props} />) };
}

beforeEach(() => {
    vi.mocked(getOfflineDependents).mockReset().mockResolvedValue([]);
    vi.mocked(ScheduleDialog).mockClear();
});

afterEach(cleanup);

describe('DependencyAwareScheduleDialog', () => {
    it('does not read dependents while closed, even when the target changes', () => {
        const { props, rerender } = renderDialog({ open: false });
        rerender(<DependencyAwareScheduleDialog {...props} groupId={2} path="other.yaml" />);
        expect(getOfflineDependents).not.toHaveBeenCalled();
        expect(currentDialog().onSave).toBe(props.onSave);
    });

    it('preserves the original schedule props and permits same-frequency time edits while loading', async () => {
        const request = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValue(request.promise);
        const { props, rerender } = renderDialog();
        expect(getOfflineDependents).toHaveBeenCalledWith(1, props.path);
        expect(currentDialog()).toMatchObject({
            open: true, schedule: props.schedule, cron: props.cron, period: props.period,
            timezone: props.timezone, flowId: props.flowId, saving: false,
            hasRemote: false, hasLocalOrUnpushedChanges: true, onOpenChange: props.onOpenChange,
            periodChangeDisabled: true,
        });
        expect(screen.getByRole('region', { name: '调度依赖检查' }).getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/加载中/)).toBeNull();
        act(() => currentDialog().onPeriodChange('WEEKLY'));
        expect(props.onPeriodChange).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toContain('其他编辑已保留');
        act(() => {
            currentDialog().onPeriodChange('DAILY', parts);
            currentDialog().onSave();
            currentDialog().onToggle(true);
        });
        expect(props.onPeriodChange).toHaveBeenCalledWith('DAILY', parts);
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(props.onToggle).toHaveBeenCalledWith(true);
        rerender(<DependencyAwareScheduleDialog {...props} cron="30 7 * * *" saving />);
        expect(currentDialog().saving).toBe(true);
        expect(getOfflineDependents).toHaveBeenCalledOnce();
        await act(async () => request.resolve([]));
        expect(currentDialog().periodChangeDisabled).toBe(false);
    });

    it('permits frequency changes and staging after a successful empty check', async () => {
        const { props, rerender } = renderDialog({ savedPeriod: 'DAILY' });
        await waitFor(() => expect(currentDialog().periodChangeDisabled).toBe(false));
        act(() => currentDialog().onPeriodChange('WEEKLY', parts));
        expect(props.onPeriodChange).toHaveBeenCalledWith('WEEKLY', parts);
        rerender(<DependencyAwareScheduleDialog {...props} period="WEEKLY" cron="30 7 * * 1" />);
        act(() => { currentDialog().onSave(); currentDialog().onToggle(false); });
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(props.onToggle).toHaveBeenCalledWith(false);
        expect(getOfflineDependents).toHaveBeenCalledOnce();
    });

    it('locks frequency for upstream dependencies without disabling time changes or staging', async () => {
        const { props } = renderDialog({ dependencyConfig: upstream });
        await screen.findByText(/请先解除本任务的前置依赖/);
        await waitFor(() => expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false'));
        expect(currentDialog().periodChangeDisabled).toBe(true);
        act(() => {
            currentDialog().onPeriodChange('HOURLY');
            currentDialog().onPeriodChange('DAILY', parts);
            currentDialog().onSave();
            currentDialog().onToggle(true);
        });
        expect(props.onPeriodChange).toHaveBeenCalledOnce();
        expect(props.onPeriodChange).toHaveBeenCalledWith('DAILY', parts);
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(props.onToggle).toHaveBeenCalledWith(true);
    });

    it('preserves a newly staged frequency when upstreams were added to that draft', async () => {
        const { props } = renderDialog({
            savedPeriod: 'DAILY',
            period: 'MONTHLY',
            cron: '30 6 1 * *',
            dependencyConfig: upstream,
        });
        await waitFor(() => expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false'));
        act(() => currentDialog().onSave());
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(screen.queryByText(/当前草稿频率/)).toBeNull();
    });

    it('shows downstream groups, tasks and paths, including unnamed groups', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([dependent, { ...dependent, groupId: 4, groupName: null }]);
        renderDialog({ dependencyConfig: upstream });
        const list = await screen.findByRole('list', { name: '下游任务' });
        expect(screen.getByText('数据分析 / daily_report')).toBeTruthy();
        expect(screen.getByText('项目组 4 / daily_report')).toBeTruthy();
        expect(screen.getAllByText(dependent.path)).toHaveLength(2);
        expect(screen.getByText(/请先在下游任务中解除依赖/)).toBeTruthy();
        expect(screen.getByText(/请先解除本任务的前置依赖/)).toBeTruthy();
        expect(list.style.maxHeight).toBe('128px');
        expect(list.tabIndex).toBe(0);
        expect(list.closest('p')).toBeNull();
        expect(currentDialog().periodChangeDisabled).toBe(true);
    });

    it('collapses long downstream lists rather than filling the schedule body', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue(Array.from({ length: 25 }, (_, groupId) => ({ ...dependent, groupId })));
        renderDialog();
        const summary = await screen.findByText('下游任务（25）');
        expect(summary.closest('details')?.open).toBe(false);
        expect(summary.tagName).toBe('SUMMARY');
    });

    it.each([true, false])('blocks save and toggle(%s) against persisted period, not a staged schedule snapshot', async (enabled) => {
        vi.mocked(getOfflineDependents).mockResolvedValue([dependent]);
        const { props } = renderDialog({ savedPeriod: 'HOURLY', period: 'WEEKLY', cron: '30 6 * * 1' });
        await screen.findByRole('list', { name: '下游任务' });
        act(() => { currentDialog().onSave(); currentDialog().onToggle(enabled); });
        expect(props.onSave).not.toHaveBeenCalled();
        expect(props.onToggle).not.toHaveBeenCalled();
        expect(props.onPeriodChange).not.toHaveBeenCalled();
        expect(currentDialog().cron).toBe('30 6 * * 1');
        expect(currentDialog().period).toBe('WEEKLY');
        expect(screen.getByRole('alert').textContent).toContain('受保护频率「每小时」');
        expect(screen.getByRole('alert').textContent).toContain('其他编辑已保留');
    });

    it('allows explicit restoration while preserving the current time parts', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([dependent]);
        const { props, rerender } = renderDialog({ savedPeriod: 'DAILY', period: 'WEEKLY', cron: '30 7 * * 1' });
        await screen.findByRole('list', { name: '下游任务' });
        fireEvent.click(screen.getByRole('button', { name: '恢复为每天' }));
        expect(props.onPeriodChange).toHaveBeenCalledWith('DAILY', parts);
        rerender(<DependencyAwareScheduleDialog {...props} period="DAILY" cron="30 7 * * *" />);
        act(() => currentDialog().onSave());
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(screen.queryByText(/当前草稿频率/)).toBeNull();
    });

    it('keeps mismatched draft time edits but never stages their protected frequency', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([dependent]);
        const { props } = renderDialog({ savedPeriod: 'DAILY', period: 'WEEKLY' });
        await screen.findByRole('list', { name: '下游任务' });
        act(() => {
            currentDialog().onPeriodChange('WEEKLY', parts);
            currentDialog().onPeriodChange('MONTHLY', parts);
            currentDialog().onSave();
        });
        expect(props.onPeriodChange).toHaveBeenCalledOnce();
        expect(props.onPeriodChange).toHaveBeenCalledWith('WEEKLY', parts);
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('fails closed for changed frequency during loading and failure but allows same-frequency edits and retry', async () => {
        const request = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValueOnce(request.promise).mockResolvedValueOnce([]);
        const { props, rerender } = renderDialog({ savedPeriod: 'HOURLY' });
        act(() => { currentDialog().onSave(); currentDialog().onToggle(true); });
        expect(props.onSave).not.toHaveBeenCalled();
        expect(props.onToggle).not.toHaveBeenCalled();
        await act(async () => request.reject(new Error('连接中断')));
        expect(screen.getByText(/下游依赖读取失败：连接中断/)).toBeTruthy();
        expect(currentDialog().periodChangeDisabled).toBe(true);
        act(() => { currentDialog().onSave(); currentDialog().onToggle(false); });
        expect(props.onSave).not.toHaveBeenCalled();
        expect(props.onToggle).not.toHaveBeenCalled();
        rerender(<DependencyAwareScheduleDialog {...props} period="HOURLY" />);
        act(() => {
            currentDialog().onPeriodChange('HOURLY', parts);
            currentDialog().onSave();
            currentDialog().onToggle(true);
        });
        expect(props.onPeriodChange).toHaveBeenCalledWith('HOURLY', parts);
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(props.onToggle).toHaveBeenCalledWith(true);
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(currentDialog().periodChangeDisabled).toBe(true);
        await waitFor(() => expect(currentDialog().periodChangeDisabled).toBe(false));
        expect(screen.queryByText(/读取失败/)).toBeNull();
        expect(getOfflineDependents).toHaveBeenCalledTimes(2);
    });

    it.each([undefined, null])('does not invent DAILY when savedPeriod is %s and no schedule exists', async (savedPeriod) => {
        const { props } = renderDialog({ schedule: null, savedPeriod, period: 'HOURLY', dependencyConfig: upstream });
        await waitFor(() => expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false'));
        act(() => { currentDialog().onSave(); currentDialog().onToggle(true); });
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(props.onToggle).toHaveBeenCalledWith(true);
        expect(screen.queryByText(/当前草稿频率/)).toBeNull();
        expect(currentDialog().periodChangeDisabled).toBe(true);
    });

    it('uses current frequency rather than a draft schedule when no schedule is persisted', async () => {
        const { props } = renderDialog({ savedPeriod: null, period: 'MONTHLY', dependencyConfig: upstream });
        await waitFor(() => expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false'));
        act(() => currentDialog().onSave());
        expect(props.onSave).toHaveBeenCalledOnce();
        expect(screen.queryByText(/当前草稿频率/)).toBeNull();
    });

    it('does not normalize CUSTOM to DAILY as a side effect of dependency checks', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([dependent]);
        const { props } = renderDialog({ savedPeriod: 'CUSTOM', period: 'CUSTOM', cron: '0 1,8 * * *' });
        await screen.findByRole('list', { name: '下游任务' });
        act(() => currentDialog().onPeriodChange('DAILY', parts));
        expect(props.onPeriodChange).not.toHaveBeenCalled();
        expect(currentDialog().period).toBe('CUSTOM');
    });

    it.each([{ groupId: 2 }, { path: 'other.yaml' }])('clears old results and ignores late success after target change: %j', async (target) => {
        const old = deferred<OfflineDependentItem[]>();
        const next = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
        const { props, rerender } = renderDialog();
        rerender(<DependencyAwareScheduleDialog {...props} {...target} />);
        expect(currentDialog().periodChangeDisabled).toBe(true);
        await act(async () => next.resolve([dependent]));
        await act(async () => old.resolve([]));
        expect(currentDialog().periodChangeDisabled).toBe(true);
        expect(screen.getByRole('list', { name: '下游任务' })).toBeTruthy();
        expect(getOfflineDependents).toHaveBeenCalledTimes(2);
    });

    it('ignores a late rejection after closing and reopening the same task', async () => {
        const old = deferred<OfflineDependentItem[]>();
        const next = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
        const { props, rerender } = renderDialog();
        rerender(<DependencyAwareScheduleDialog {...props} open={false} />);
        rerender(<DependencyAwareScheduleDialog {...props} />);
        expect(currentDialog().periodChangeDisabled).toBe(true);
        await act(async () => next.resolve([]));
        await act(async () => old.reject(new Error('过期错误')));
        expect(currentDialog().periodChangeDisabled).toBe(false);
        expect(screen.queryByText(/过期错误/)).toBeNull();
        expect(getOfflineDependents).toHaveBeenCalledTimes(2);
    });

    it('does not reuse a prior successful check after the target changes', async () => {
        const pending = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockResolvedValueOnce([]).mockReturnValueOnce(pending.promise);
        const { props, rerender } = renderDialog();
        await waitFor(() => expect(currentDialog().periodChangeDisabled).toBe(false));
        rerender(<DependencyAwareScheduleDialog {...props} path="other.yaml" />);
        expect(currentDialog().periodChangeDisabled).toBe(true);
        await act(async () => pending.resolve([]));
    });

    it.each([{ groupId: null }, { path: null }])('does not request missing identity: %j', (target) => {
        const { props } = renderDialog(target);
        expect(getOfflineDependents).not.toHaveBeenCalled();
        expect(currentDialog().periodChangeDisabled).toBe(true);
        expect(screen.getByText(/无法确认当前任务/)).toBeTruthy();
        act(() => currentDialog().onPeriodChange('WEEKLY'));
        expect(props.onPeriodChange).not.toHaveBeenCalled();
    });
});
