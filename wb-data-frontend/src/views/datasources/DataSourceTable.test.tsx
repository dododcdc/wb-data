import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { DataSource } from '../../api/datasource';
import { TooltipProvider } from '../../components/ui/tooltip';
import { DataSourceTable } from './DataSourceTable';

afterEach(cleanup);

const dataSource = {
    id: 1,
    name: 'Alpha',
    type: 'MYSQL',
    host: 'omarchy.local',
    port: 3306,
    databaseName: 'app',
    status: 'ENABLED',
    owner: 'Wenbin',
    updatedAt: '2026-11-01T08:00:00Z',
} as DataSource;

function renderTable(overrides: Partial<ComponentProps<typeof DataSourceTable>> = {}) {
    const props: ComponentProps<typeof DataSourceTable> = {
        data: [dataSource],
        canWrite: true,
        isRefreshing: false,
        errorMessage: '',
        hasActiveFilter: false,
        hasFooter: true,
        onView: vi.fn(),
        onTest: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onToggleStatus: vi.fn(),
        onCreate: vi.fn(),
        onClearFilters: vi.fn(),
        onRetry: vi.fn(),
        deletePendingId: null,
        statusPendingId: null,
        testPendingId: null,
        ...overrides,
    };
    render(<TooltipProvider><DataSourceTable {...props} /></TooltipProvider>);
    return props;
}

describe('DataSourceTable', () => {
    it('opens details from the primary name and keeps only two direct actions', () => {
        const props = renderTable();

        expect(screen.getByText('omarchy.local:3306/app')).toBeTruthy();
        expect(screen.getByRole('button', { name: '测试连接' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '编辑数据源' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '删除数据源' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '查看数据源 Alpha' }));
        expect(props.onView).toHaveBeenCalledWith(1);

        fireEvent.click(screen.getByRole('button', { name: 'Alpha的更多操作' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '删除数据源' }));
        expect(props.onDelete).toHaveBeenCalledWith(dataSource);
    });

    it('does not expose write actions to read-only users', () => {
        renderTable({ canWrite: false });

        expect(screen.getByRole('button', { name: '测试连接' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '编辑数据源' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Alpha的更多操作' })).toBeNull();
    });

    it('distinguishes filtered empty state and clears the filter', () => {
        const props = renderTable({ data: [], hasActiveFilter: true, hasFooter: false });

        expect(screen.getByText('没有匹配的数据源')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '清空筛选' }));
        expect(props.onClearFilters).toHaveBeenCalledOnce();
    });

    it('offers retry when the initial request fails', () => {
        const props = renderTable({ data: [], errorMessage: '网络连接失败', hasFooter: false });

        expect(screen.getByText('网络连接失败')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(props.onRetry).toHaveBeenCalledOnce();
    });
});
