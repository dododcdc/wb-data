import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { OperationsExecutionListItem } from '../../api/operations';
import { TooltipProvider } from '../../components/ui/tooltip';
import { formatBrowserDateTime } from '../../lib/dateTime';
import { OperationsTable } from './OperationsTable';

afterEach(cleanup);

const execution: OperationsExecutionListItem = {
    id: 'exec-1',
    namespace: 'g4-main',
    flowId: 'daily_policy',
    branch: 'main',
    ownerUserId: 12,
    ownerName: '小红',
    ownerUsername: 'xiaohong',
    ownerStatus: 'ACTIVE',
    status: 'FAILED',
    plannedAt: '2026-06-07T00:00:00Z',
    createdAt: '2026-06-07T01:00:00Z',
    startDate: '2026-06-07T01:00:02Z',
    endDate: '2026-06-07T01:03:12Z',
    durationMs: 190000,
    rerunnable: true,
    rerun: false,
};

function renderTable(overrides: Partial<ComponentProps<typeof OperationsTable>> = {}) {
    const props: ComponentProps<typeof OperationsTable> = {
        rows: [execution],
        canRerun: true,
        isLoading: false,
        isRefreshing: false,
        errorMessage: '',
        hasFooter: true,
        pendingRerunId: null,
        onOpenDetail: vi.fn(),
        onRerun: vi.fn(),
        onResetFilters: vi.fn(),
        onRetry: vi.fn(),
        ...overrides,
    };
    const view = render(<TooltipProvider><OperationsTable {...props} /></TooltipProvider>);
    return { props, ...view };
}

describe('OperationsTable', () => {
    it('supports row and keyboard navigation and displays end time', () => {
        const { props } = renderTable();

        expect(screen.getAllByRole('columnheader')).toHaveLength(9);
        expect(screen.getByRole('columnheader', { name: '负责人' })).toBeTruthy();
        expect(screen.getByText('小红')).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: '结束时间' })).toBeTruthy();
        expect(screen.getByText(formatBrowserDateTime(execution.endDate))).toBeTruthy();
        const row = screen.getByRole('row', { name: '查看 daily_policy 执行详情' });
        fireEvent.click(row);
        fireEvent.keyDown(row, { key: 'Enter' });
        fireEvent.keyDown(row, { key: ' ' });
        expect(props.onOpenDetail).toHaveBeenCalledTimes(3);
        expect(props.onOpenDetail).toHaveBeenCalledWith('exec-1');

        fireEvent.click(screen.getByRole('button', { name: '查看 daily_policy 详情' }));
        expect(props.onOpenDetail).toHaveBeenCalledTimes(4);
    });

    it('preserves rerun permission and pending behavior', () => {
        const { props, rerender } = renderTable();
        fireEvent.click(screen.getByRole('button', { name: '重跑 daily_policy' }));
        expect(props.onRerun).toHaveBeenCalledWith(execution);
        expect(props.onOpenDetail).not.toHaveBeenCalled();

        rerender(<TooltipProvider><OperationsTable {...props} canRerun={false} /></TooltipProvider>);
        expect(screen.queryByRole('button', { name: '重跑 daily_policy' })).toBeNull();
    });

    it('allows keyboard activation of row action buttons', () => {
        const { props } = renderTable();
        const rerunButton = screen.getByRole('button', { name: '重跑 daily_policy' });

        expect(fireEvent.keyDown(rerunButton, { key: 'Enter' })).toBe(true);
        fireEvent.click(rerunButton);
        expect(fireEvent.keyDown(rerunButton, { key: ' ' })).toBe(true);
        fireEvent.click(rerunButton);

        expect(props.onRerun).toHaveBeenCalledTimes(2);
        expect(props.onOpenDetail).not.toHaveBeenCalled();
    });

    it('resets filters from the empty state', () => {
        const { props } = renderTable({ rows: [], hasFooter: false });

        expect(screen.getByText('没有匹配的运行记录')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
        expect(props.onResetFilters).toHaveBeenCalledOnce();
    });

    it('renders loading and initial error states', () => {
        const loading = renderTable({ rows: [], isLoading: true, hasFooter: false });
        expect(loading.container.querySelector('.wb-list-skeleton')).toBeTruthy();
        loading.unmount();

        const { props } = renderTable({ rows: [], errorMessage: '网络连接失败', hasFooter: false });
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(props.onRetry).toHaveBeenCalledOnce();
    });

    it('renders stop action only on active rows when permitted and triggers onStop without opening detail', () => {
        const activeExecution: OperationsExecutionListItem = {
            ...execution,
            id: 'exec-run',
            flowId: 'hourly_sync',
            status: 'RUNNING',
            endDate: null,
            durationMs: null,
            rerunnable: false,
            stoppable: true,
        };
        const { props, rerender } = renderTable({
            rows: [activeExecution, execution],
            canStop: true,
            onStop: vi.fn(),
        });

        const stopButton = screen.getByRole('button', { name: '停止 hourly_sync' });
        expect(screen.queryByRole('button', { name: '停止 daily_policy' })).toBeNull();

        fireEvent.click(stopButton);
        expect(props.onStop).toHaveBeenCalledWith(activeExecution);
        expect(props.onOpenDetail).not.toHaveBeenCalled();

        rerender(
            <TooltipProvider>
                <OperationsTable {...props} rows={[activeExecution, execution]} canStop={false} />
            </TooltipProvider>
        );
        expect(screen.queryByRole('button', { name: '停止 hourly_sync' })).toBeNull();
    });

    it('distinguishes manual rerun, auto retry badges, and retried status', () => {
        renderTable({
            rows: [
                {
                    ...execution,
                    id: 'exec-retried',
                    flowId: 'flow_retried',
                    status: 'RETRIED',
                    rerunnable: false,
                    rerun: false,
                    rerunType: 'NONE',
                },
                {
                    ...execution,
                    id: 'exec-auto-numbered',
                    flowId: 'flow_auto_1',
                    status: 'SUCCESS',
                    rerunnable: false,
                    rerun: true,
                    rerunType: 'AUTO',
                    retryAttempt: 2,
                },
                {
                    ...execution,
                    id: 'exec-auto-plain',
                    flowId: 'flow_auto_2',
                    status: 'RUNNING',
                    rerunnable: false,
                    rerun: true,
                    rerunType: 'AUTO',
                    retryAttempt: null,
                },
                {
                    ...execution,
                    id: 'exec-manual',
                    flowId: 'flow_manual',
                    status: 'SUCCESS',
                    rerunnable: false,
                    rerun: true,
                    rerunType: 'MANUAL',
                },
                {
                    ...execution,
                    id: 'exec-manual-partial',
                    flowId: 'flow_manual_partial',
                    status: 'SUCCESS',
                    rerunnable: false,
                    rerun: true,
                    rerunType: 'MANUAL',
                    partialRerun: true,
                    rerunSelectedTaskCount: 2,
                    rerunTotalTaskCount: 4,
                },
            ],
        });

        expect(screen.getByText('已重试')).toBeTruthy();
        expect(screen.getByText('自动重试 #2')).toBeTruthy();
        expect(screen.getByText('自动重试')).toBeTruthy();
        expect(screen.getByText('手动重跑')).toBeTruthy();
        const partialBadge = screen.getByText('手动重跑 · 2/4');
        expect(partialBadge.getAttribute('title')).toBe('手动部分重跑（执行 2 / 共 4 个节点）');
    });

    it('renders concise action tooltip text separate from row-qualified aria-label', async () => {
        render(
            <TooltipProvider delayDuration={0} disableHoverableContent>
                <OperationsTable
                    rows={[
                        execution,
                        {
                            ...execution,
                            id: 'exec-run',
                            flowId: 'hourly_sync',
                            status: 'RUNNING',
                            rerunnable: false,
                            stoppable: true,
                        },
                    ]}
                    canRerun
                    canStop
                    isLoading={false}
                    isRefreshing={false}
                    errorMessage=""
                    hasFooter
                    pendingRerunId={null}
                    onOpenDetail={vi.fn()}
                    onRerun={vi.fn()}
                    onStop={vi.fn()}
                    onResetFilters={vi.fn()}
                    onRetry={vi.fn()}
                />
            </TooltipProvider>,
        );

        const detailBtn = screen.getByRole('button', { name: '查看 daily_policy 详情' });
        fireEvent.focus(detailBtn);
        const detailTooltip = await screen.findByRole('tooltip');
        expect(detailTooltip.textContent).toBe('查看详情');
        expect(detailTooltip.closest<HTMLElement>('[data-radix-popper-content-wrapper]')?.style.pointerEvents).toBe('none');

        const rerunBtn = screen.getByRole('button', { name: '重跑 daily_policy' });
        fireEvent.focus(rerunBtn);
        expect((await screen.findByRole('tooltip')).textContent).toBe('重跑');

        const stopBtn = screen.getByRole('button', { name: '停止 hourly_sync' });
        fireEvent.focus(stopBtn);
        expect((await screen.findByRole('tooltip')).textContent).toBe('停止');
    });

    it('renders mark-success action on markable rows, teal pill on FORCE_SUCCESS, and hides action without permission', async () => {
        const forcedRow: OperationsExecutionListItem = {
            ...execution,
            id: 'exec-forced',
            flowId: 'forced_job',
            status: 'FORCE_SUCCESS',
            rerunnable: false,
            stoppable: false,
            markableSuccess: false,
        };
        const { props, rerender } = renderTable({
            rows: [execution, forcedRow],
            canMarkSuccess: true,
            onMarkSuccess: vi.fn(),
        });

        // Failed row shows all 3 buttons directly without overflow menu
        expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
        const detailBtn = screen.getByRole('button', { name: '查看 daily_policy 详情' });
        const rerunBtn = screen.getByRole('button', { name: '重跑 daily_policy' });
        const markBtn = screen.getByRole('button', { name: '置成功 daily_policy' });
        expect(detailBtn).toBeTruthy();
        expect(rerunBtn).toBeTruthy();
        expect(markBtn).toBeTruthy();

        fireEvent.focus(markBtn);
        expect((await screen.findByRole('tooltip')).textContent).toBe('置成功');

        fireEvent.click(markBtn);
        expect(props.onMarkSuccess).toHaveBeenCalledWith(execution);
        expect(props.onOpenDetail).not.toHaveBeenCalled();

        // FORCE_SUCCESS renders teal pill and hides rerun & mark-success
        const forcedPill = screen.getByText('人工置成功');
        expect(forcedPill.className).toContain('is-teal');
        expect(screen.queryByRole('button', { name: '重跑 forced_job' })).toBeNull();
        expect(screen.queryByRole('button', { name: '置成功 forced_job' })).toBeNull();

        // Without write permission, mark-success button disappears
        rerender(
            <TooltipProvider>
                <OperationsTable {...props} rows={[execution, forcedRow]} canMarkSuccess={false} />
            </TooltipProvider>,
        );
        expect(screen.queryByRole('button', { name: '置成功 daily_policy' })).toBeNull();
    });
});
