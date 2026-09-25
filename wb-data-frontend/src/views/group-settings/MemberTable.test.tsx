import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/tooltip';
import MemberTable from './MemberTable';

const member = { id: 2, userId: 2, username: 'alice', displayName: 'Alice', role: 'GROUP_ADMIN', createdAt: '2026-05-03T00:00:00Z' };
afterEach(cleanup);

describe('MemberTable', () => {
    it('allows managing the only administrator on this page; the server enforces the group-wide invariant', () => {
        const onChangeRole = vi.fn();
        const onRemove = vi.fn();
        render(<TooltipProvider><MemberTable data={[member]} isRefreshing={false} errorMessage="" canManage currentUserId={1} onChangeRole={onChangeRole} onRemove={onRemove} /></TooltipProvider>);
        fireEvent.click(screen.getByRole('button', { name: '修改角色' }));
        fireEvent.click(screen.getByRole('button', { name: '移除成员' }));
        expect(onChangeRole).toHaveBeenCalledWith(member);
        expect(onRemove).toHaveBeenCalledWith(member);
    });

    it.each([[true, 2], [false, 1]] as const)('keeps self/permission restrictions (%s, %s)', (canManage, currentUserId) => {
        render(<TooltipProvider><MemberTable data={[member]} isRefreshing={false} errorMessage="" canManage={canManage} currentUserId={currentUserId} onChangeRole={vi.fn()} onRemove={vi.fn()} /></TooltipProvider>);
        expect(screen.queryByRole('button', { name: '修改角色' })).toBeNull();
        expect(screen.queryByRole('button', { name: '移除成员' })).toBeNull();
    });
});
