import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddMemberDialog from './AddMemberDialog';
import type { AvailableUser } from '../../api/groupSettings';

const { getAvailableUsers } = vi.hoisted(() => ({
    getAvailableUsers: vi.fn(),
}));

vi.mock('../../api/groupSettings', () => ({
    getAvailableUsers,
}));

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

async function advanceDebounce() {
    await act(async () => {
        vi.advanceTimersByTime(300);
    });
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('AddMemberDialog', () => {
    it('shows an explicit error state when member search fails', async () => {
        vi.useFakeTimers();
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
        const input = dialog.getByPlaceholderText('搜索用户名');
        
        fireEvent.change(input, {
            target: { value: 'alice' },
        });

        await advanceDebounce();

        expect(screen.getByText('搜索失败，请稍后重试')).toBeTruthy();
        expect(screen.queryByText('未找到匹配的用户')).toBeNull();
    });

    it('clears the search error immediately when the input is cleared', async () => {
        vi.useFakeTimers();
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
        const input = dialog.getByPlaceholderText('搜索用户名');

        fireEvent.change(input, { target: { value: 'alice' } });

        await advanceDebounce();

        expect(screen.getByText('搜索失败，请稍后重试')).toBeTruthy();

        fireEvent.change(input, { target: { value: '' } });

        expect(screen.queryByText('搜索失败，请稍后重试')).toBeNull();
    });

    it('ignores stale failed requests after a newer search succeeds', async () => {
        vi.useFakeTimers();

        const aliceRequest = createDeferred<AvailableUser[]>();
        const bobRequest = createDeferred<AvailableUser[]>();
        getAvailableUsers
            .mockReturnValueOnce(aliceRequest.promise)
            .mockReturnValueOnce(bobRequest.promise);

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));
        const input = dialog.getByPlaceholderText('搜索用户名');

        fireEvent.change(input, { target: { value: 'alice' } });
        await advanceDebounce();

        fireEvent.change(input, { target: { value: 'bob' } });
        await advanceDebounce();

        await act(async () => {
            bobRequest.resolve([{ id: 7, username: 'bob', displayName: 'Bob' }]);
        });
        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            aliceRequest.reject(new Error('network down'));
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(dialog.queryByText('搜索失败，请稍后重试')).toBeNull();
        expect(screen.getByRole('option', { name: 'bob', hidden: true })).toBeTruthy();
    });

    it('does not trigger a search for whitespace-only input', async () => {
        vi.useFakeTimers();

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));
        const input = dialog.getByPlaceholderText('搜索用户名');

        fireEvent.change(input, { target: { value: '   ' } });

        await advanceDebounce();

        expect(getAvailableUsers).not.toHaveBeenCalled();
        expect(dialog.queryByText('未找到匹配的用户')).toBeNull();
        expect(dialog.queryByText('搜索失败，请稍后重试')).toBeNull();
    });

    it('submits selected user ids with one shared role and username-only options', async () => {
        vi.useFakeTimers();
        getAvailableUsers
            .mockResolvedValueOnce([{ id: 7, username: 'bob', displayName: 'Bob 管理员' }])
            .mockResolvedValueOnce([{ id: 8, username: 'alice', displayName: 'Alice 开发者' }]);

        const onSuccess = vi.fn();

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={onSuccess}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));

        fireEvent.change(dialog.getByPlaceholderText('搜索用户名'), { target: { value: 'bob' } });
        await advanceDebounce();
        fireEvent.click(screen.getByRole('option', { name: 'bob', hidden: true }));
        expect(screen.queryByText('Bob 管理员')).toBeNull();

        fireEvent.change(dialog.getByPlaceholderText('搜索用户名'), { target: { value: 'ali' } });
        await advanceDebounce();
        fireEvent.click(screen.getByRole('option', { name: 'alice', hidden: true }));

        fireEvent.click(dialog.getByRole('button', { name: '添加 2 名成员', hidden: true }));

        expect(onSuccess).toHaveBeenCalledWith(
            { userIds: [7, 8], role: 'DEVELOPER' },
            ['bob', 'alice'],
        );
    });

    it('supports removing one member and clearing all members', async () => {
        vi.useFakeTimers();
        getAvailableUsers
            .mockResolvedValueOnce([{ id: 7, username: 'bob', displayName: 'Bob 管理员' }])
            .mockResolvedValueOnce([{ id: 8, username: 'alice', displayName: 'Alice 开发者' }]);

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));

        fireEvent.change(dialog.getByPlaceholderText('搜索用户名'), { target: { value: 'bob' } });
        await advanceDebounce();
        fireEvent.click(screen.getByRole('option', { name: 'bob', hidden: true }));

        fireEvent.change(dialog.getByPlaceholderText('搜索用户名'), { target: { value: 'ali' } });
        await advanceDebounce();
        fireEvent.click(screen.getByRole('option', { name: 'alice', hidden: true }));

        fireEvent.click(screen.getByRole('button', { name: '移除 bob', hidden: true }));
        expect(dialog.getByRole('button', { name: '添加 1 名成员', hidden: true })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '清空全部已选成员', hidden: true }));
        expect(dialog.getByRole('button', { name: '添加 0 名成员', hidden: true }).hasAttribute('disabled')).toBeTruthy();
    });
});
