import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddMemberDialog from './AddMemberDialog';

const { getAvailableUsers } = vi.hoisted(() => ({
    getAvailableUsers: vi.fn(),
}));

vi.mock('../../api/groupSettings', () => ({
    getAvailableUsers,
}));

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('AddMemberDialog', () => {
    it('shows an explicit error state when member search fails', async () => {
        getAvailableUsers.mockRejectedValueOnce(new Error('network down'));

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));
        const input = dialog.getByPlaceholderText('搜索用户名或展示名');
        
        fireEvent.change(input, {
            target: { value: 'alice' },
        });

        await waitFor(
            () => {
                expect(dialog.getByText('搜索失败，请稍后重试')).toBeTruthy();
            },
            { timeout: 2000 },
        );
        expect(dialog.queryByText('未找到匹配的用户')).toBeNull();
    });

    it('clears the search error immediately when the input is cleared', async () => {
        getAvailableUsers.mockRejectedValueOnce(new Error('network down'));

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));
        const input = dialog.getByPlaceholderText('搜索用户名或展示名');

        fireEvent.change(input, { target: { value: 'alice' } });

        await waitFor(
            () => {
                expect(dialog.getByText('搜索失败，请稍后重试')).toBeTruthy();
            },
            { timeout: 2000 },
        );

        fireEvent.change(input, { target: { value: '' } });

        expect(dialog.queryByText('搜索失败，请稍后重试')).toBeNull();
    });
});
