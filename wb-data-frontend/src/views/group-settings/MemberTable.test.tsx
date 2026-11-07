import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { TooltipProvider } from '../../components/ui/tooltip';
import MemberTable from './MemberTable';

const member = { id: 2, userId: 2, username: 'alice', displayName: 'Alice', role: 'GROUP_ADMIN', createdAt: '2026-05-03T00:00:00Z' };
afterEach(cleanup);

function renderTable(overrides: Partial<ComponentProps<typeof MemberTable>> = {}) {
    const props: ComponentProps<typeof MemberTable> = {
        data: [member],
        isLoading: false,
        isRefreshing: false,
        errorMessage: '',
        hasActiveFilter: false,
        hasFooter: true,
        canManage: true,
        currentUserId: 1,
        onChangeRole: vi.fn(),
        onRemove: vi.fn(),
        onAddMember: vi.fn(),
        onClearFilters: vi.fn(),
        onRetry: vi.fn(),
        ...overrides,
    };
    const view = render(<TooltipProvider><MemberTable {...props} /></TooltipProvider>);
    return { props, ...view };
}

describe('MemberTable', () => {
    it('allows managing the only administrator on this page; the server enforces the group-wide invariant', () => {
        const { props } = renderTable();

        fireEvent.click(screen.getByRole('button', { name: '修改角色' }));
        expect(props.onChangeRole).toHaveBeenCalledWith(member);
        expect(screen.queryByRole('button', { name: '移除成员' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'alice的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '移除成员' }));
        expect(props.onRemove).toHaveBeenCalledWith(member);
    });

    it('marks the current account without exposing self actions', () => {
        renderTable({ currentUserId: 2 });

        expect(screen.getByText('我')).toBeTruthy();
        expect(screen.getByText('当前账号')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '修改角色' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'alice的更多操作' })).toBeNull();
    });

    it('hides the entire action column without manage permission', () => {
        renderTable({ canManage: false });

        expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull();
        expect(screen.queryByRole('button', { name: '修改角色' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'alice的更多操作' })).toBeNull();
    });

    it('shows the filtered empty state and clears search', () => {
        const { props } = renderTable({ data: [], hasActiveFilter: true, hasFooter: false });

        expect(screen.getByText('没有匹配的成员')).toBeTruthy();
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
