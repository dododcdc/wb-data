import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { OperationsExecutionListItem } from '../../api/operations';
import { TooltipProvider } from '../../components/ui/tooltip';
import { OperationsTable } from './OperationsTable';

afterEach(cleanup);

const execution: OperationsExecutionListItem = {
    id: 'exec-1',
    namespace: 'g4-main',
    flowId: 'daily_policy',
    branch: 'main',
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
    it('supports row and keyboard navigation without showing end time', () => {
        const { props } = renderTable();

        expect(screen.getAllByRole('columnheader')).toHaveLength(7);
        expect(screen.queryByRole('columnheader', { name: '结束时间' })).toBeNull();
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
});
