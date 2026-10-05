import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login } from '@/api/auth';
import { useAuthStore } from '@/utils/auth';
import Login from './Login';

vi.mock('@/api/auth', () => ({
    login: vi.fn(),
    logout: vi.fn(),
    getAuthContext: vi.fn(),
    selectGroupContext: vi.fn(),
}));

function LocationDisplay() {
    const location = useLocation();
    return <div data-testid="location-path">{location.pathname}</div>;
}

function renderLogin(initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/login']) {
    return render(
        <MemoryRouter initialEntries={initialEntries}>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<LocationDisplay />} />
                <Route path="/target-page" element={<LocationDisplay />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('Login Component', () => {
    beforeEach(() => {
        useAuthStore.getState().clearAuth();
        vi.mocked(login).mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('displays validation errors when submitting empty credentials', async () => {
        renderLogin();

        const submitBtn = screen.getByRole('button', { name: '登录' });
        fireEvent.click(submitBtn);

        expect(await screen.findByText('请输入用户名')).toBeTruthy();
        expect(await screen.findByText('请输入密码')).toBeTruthy();
        expect(login).not.toHaveBeenCalled();
    });

    it('submits form, saves credentials and redirects to root by default', async () => {
        vi.mocked(login).mockResolvedValue({
            accessToken: 'test-token',
            tokenType: 'Bearer',
            expiresAt: '2099-01-01T00:00:00Z',
            user: { id: 1, username: 'admin', displayName: 'Admin', systemRole: 'SYSTEM_ADMIN' },
        });

        renderLogin();

        fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: '登录' }));

        await waitFor(() => {
            expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'password123' });
        });

        expect(useAuthStore.getState().token).toBe('test-token');
        expect(useAuthStore.getState().userInfo?.username).toBe('admin');
        expect((await screen.findByTestId('location-path')).textContent).toBe('/');
    });

    it('redirects to the original location when provided via location state', async () => {
        vi.mocked(login).mockResolvedValue({
            accessToken: 'test-token',
            tokenType: 'Bearer',
            expiresAt: '2099-01-01T00:00:00Z',
            user: { id: 1, username: 'admin', displayName: 'Admin', systemRole: 'SYSTEM_ADMIN' },
        });

        renderLogin([{ pathname: '/login', state: { from: { pathname: '/target-page' } } }]);

        fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: '登录' }));

        expect((await screen.findByTestId('location-path')).textContent).toBe('/target-page');
    });

    it('displays server error message on login failure', async () => {
        vi.mocked(login).mockRejectedValue(new Error('用户名或密码错误'));

        renderLogin();

        fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'wrong-pass' } });
        fireEvent.click(screen.getByRole('button', { name: '登录' }));

        expect(await screen.findByText('用户名或密码错误')).toBeTruthy();
        expect(useAuthStore.getState().token).toBeNull();
    });
});
