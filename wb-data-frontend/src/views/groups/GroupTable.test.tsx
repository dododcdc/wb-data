import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { GroupDetail } from '../../api/group';
import { TooltipProvider } from '../../components/ui/tooltip';
import { GroupTable } from './GroupTable';

afterEach(cleanup);

const group: GroupDetail = {
    id: 1,
    name: 'policy',
    description: '数据研发项目组',
    status: 'active',
    memberCount: 8,
    createdAt: '2026-01-01T08:00:00Z',
};

function renderTable(overrides: Partial<ComponentProps<typeof GroupTable>> = {}) {
    const props: ComponentProps<typeof GroupTable> = {
        data: [group],
        isLoading: false,
        isRefreshing: false,
        errorMessage: '',
        hasActiveFilter: false,
        hasFooter: true,
        onEdit: vi.fn(),
        onDisable: vi.fn(),
        onEnable: vi.fn(),
        onCreate: vi.fn(),
        onClearFilters: vi.fn(),
        onRetry: vi.fn(),
        pendingId: null,
        ...overrides,
    };
    const view = render(<TooltipProvider><GroupTable {...props} /></TooltipProvider>);
    return { props, ...view };
}

describe('GroupTable', () => {
    it('combines name and description and keeps only edit as a direct action', () => {
        const { props } = renderTable();

        expect(screen.getByText('policy')).toBeTruthy();
        expect(screen.getByText('数据研发项目组')).toBeTruthy();
        expect(screen.getByText('8')).toBeTruthy();
        expect(screen.getByRole('button', { name: '编辑项目组' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '禁用项目组' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '编辑项目组' }));
        expect(props.onEdit).toHaveBeenCalledWith(group);

        fireEvent.click(screen.getByRole('button', { name: 'policy的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '禁用项目组' }));
        expect(props.onDisable).toHaveBeenCalledWith(group);
    });

    it('offers enable for a disabled group', () => {
        const { props } = renderTable({ data: [{ ...group, status: 'disabled' }] });

        fireEvent.click(screen.getByRole('button', { name: 'policy的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '启用项目组' }));
        expect(props.onEnable).toHaveBeenCalledWith({ ...group, status: 'disabled' });
    });

    it('shows the filtered empty state and clears search', () => {
        const { props } = renderTable({ data: [], hasActiveFilter: true, hasFooter: false });

        expect(screen.getByText('没有匹配的项目组')).toBeTruthy();
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
