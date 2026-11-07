import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ParameterGroupSummary } from '../../api/parameterGroups';
import { TooltipProvider } from '../../components/ui/tooltip';
import { ParameterGroupTable } from './ParameterGroupTable';

afterEach(cleanup);

const record: ParameterGroupSummary = {
    id: 12,
    code: 'daily_common',
    name: '日常公共参数',
    description: '日批任务共用日期与租户参数',
    version: 3,
    revision: 8,
    status: 'ACTIVE',
    parameterCount: 2,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-08-14T08:00:00Z',
    updatedAt: '2026-08-15T08:30:00Z',
};

function renderTable(overrides: Partial<ComponentProps<typeof ParameterGroupTable>> = {}) {
    const props: ComponentProps<typeof ParameterGroupTable> = {
        data: [record],
        canWrite: true,
        isLoading: false,
        isRefreshing: false,
        errorMessage: '',
        hasActiveFilter: false,
        hasFooter: true,
        onPreview: vi.fn(),
        onEdit: vi.fn(),
        onAction: vi.fn(),
        onCreate: vi.fn(),
        onClearFilters: vi.fn(),
        onRetry: vi.fn(),
        ...overrides,
    };
    const view = render(<TooltipProvider><ParameterGroupTable {...props} /></TooltipProvider>);
    return { props, ...view };
}

describe('ParameterGroupTable', () => {
    it('keeps preview and edit direct and moves archive into the overflow menu', () => {
        const { props } = renderTable();

        fireEvent.click(screen.getByRole('button', { name: '预览日常公共参数' }));
        expect(props.onPreview).toHaveBeenCalledWith(record);
        fireEvent.click(screen.getByRole('button', { name: '编辑日常公共参数' }));
        expect(props.onEdit).toHaveBeenCalledWith(record);
        expect(screen.queryByRole('button', { name: '归档日常公共参数' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '日常公共参数的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '归档日常公共参数' }));
        expect(props.onAction).toHaveBeenCalledWith(record);
    });

    it('moves restore into the overflow menu for archived groups', () => {
        const archived = { ...record, status: 'ARCHIVED' as const };
        const { props } = renderTable({ data: [archived] });

        expect(screen.queryByRole('button', { name: '编辑日常公共参数' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '日常公共参数的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '恢复日常公共参数' }));
        expect(props.onAction).toHaveBeenCalledWith(archived);
    });

    it('exposes only preview to read-only users', () => {
        renderTable({ canWrite: false });

        expect(screen.getByRole('button', { name: '预览日常公共参数' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '编辑日常公共参数' })).toBeNull();
        expect(screen.queryByRole('button', { name: '日常公共参数的更多操作' })).toBeNull();
    });

    it('shows the filtered empty state and clears search and status filters', () => {
        const { props } = renderTable({ data: [], hasActiveFilter: true, hasFooter: false });

        expect(screen.getByText('没有匹配的参数组')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '清空筛选' }));
        expect(props.onClearFilters).toHaveBeenCalledOnce();
    });

    it('renders loading and initial error states', () => {
        const loading = renderTable({ data: [], isLoading: true, hasFooter: false });
        expect(loading.container.querySelector('.wb-list-skeleton')).toBeTruthy();
        loading.unmount();

        const { props } = renderTable({ data: [], errorMessage: '网络连接失败', hasFooter: false });
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(props.onRetry).toHaveBeenCalledOnce();
    });
});
