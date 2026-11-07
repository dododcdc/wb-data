import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { UserRecord } from '../../api/user';
import { TooltipProvider } from '../../components/ui/tooltip';
import { UserTable } from './UserTable';

afterEach(cleanup);

const user = {
    id: 1,
    username: 'admin',
    displayName: '管理员账号',
    systemRole: 'SYSTEM_ADMIN',
    status: 'ACTIVE',
    lastLoginAt: '2026-11-01T08:00:00Z',
    createdAt: '2026-01-01T08:00:00Z',
} as UserRecord;

function renderTable(overrides: Partial<ComponentProps<typeof UserTable>> = {}) {
    const props: ComponentProps<typeof UserTable> = {
        data: [user],
        isLoading: false,
        isRefreshing: false,
        errorMessage: '',
        hasActiveFilter: false,
        hasFooter: true,
        onEdit: vi.fn(),
        onToggleStatus: vi.fn(),
        onResetPassword: vi.fn(),
        onCreate: vi.fn(),
        onClearFilters: vi.fn(),
        onRetry: vi.fn(),
        statusPendingId: null,
        ...overrides,
    };
    const view = render(<TooltipProvider><UserTable {...props} /></TooltipProvider>);
    return { props, ...view };
}

describe('UserTable', () => {
    it('combines identity and keeps only edit as a direct action', () => {
        const { props } = renderTable();

        expect(screen.getByText('admin')).toBeTruthy();
        expect(screen.getByText('管理员账号')).toBeTruthy();
        expect(screen.getByText('系统管理员')).toBeTruthy();
        expect(screen.getByRole('button', { name: '编辑用户' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '重置密码' })).toBeNull();
        expect(screen.queryByRole('button', { name: '禁用用户' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '编辑用户' }));
        expect(props.onEdit).toHaveBeenCalledWith(user);

        fireEvent.click(screen.getByRole('button', { name: 'admin的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '重置密码' }));
        expect(props.onResetPassword).toHaveBeenCalledWith(user);

        fireEvent.click(screen.getByRole('button', { name: 'admin的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '禁用用户' }));
        expect(props.onToggleStatus).toHaveBeenCalledWith(user);
    });

    it('shows the filtered empty state and clears search', () => {
        const { props } = renderTable({ data: [], hasActiveFilter: true, hasFooter: false });

        expect(screen.getByText('没有匹配的用户')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '清空筛选' }));
        expect(props.onClearFilters).toHaveBeenCalledOnce();
    });

    it('renders aligned skeleton rows during initial loading', () => {
        const { container } = renderTable({ data: [], isLoading: true, hasFooter: false });

        expect(container.querySelector('.wb-list-skeleton')).toBeTruthy();
        expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
        expect(screen.queryByRole('table', { name: '用户列表' })).toBeNull();
    });

    it('offers retry when the initial request fails', () => {
        const { props } = renderTable({ data: [], errorMessage: '网络连接失败', hasFooter: false });

        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(props.onRetry).toHaveBeenCalledOnce();
    });
});
