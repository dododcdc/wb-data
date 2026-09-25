import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logout } from '../../api/auth';
import { useAuthStore } from '../../utils/auth';
import NoGroupState from './NoGroupState';

vi.mock('../../api/auth', () => ({ logout: vi.fn() }));

describe('NoGroupState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuthStore.getState().clearAuth();
        useAuthStore.getState().setToken('token');
    });

    afterEach(() => cleanup());

    it('offers a logout exit that clears the session after server confirmation', async () => {
        vi.mocked(logout).mockResolvedValueOnce(undefined);

        render(<NoGroupState />);
        fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

        await waitFor(() => expect(useAuthStore.getState().token).toBeNull());
        expect(logout).toHaveBeenCalledTimes(1);
    });

    it('keeps the session when server logout fails so the user can retry', async () => {
        vi.mocked(logout).mockRejectedValueOnce(new Error('server down'));

        render(<NoGroupState />);
        fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

        await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
        expect(useAuthStore.getState().token).toBe('token');
    });
});
