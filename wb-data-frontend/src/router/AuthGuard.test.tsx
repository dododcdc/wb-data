import { lazy } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../utils/auth';
import { AuthGuard, withRouteSuspense } from './AuthGuard';

vi.mock('../api/auth', () => ({
    getAuthContext: vi.fn(() => new Promise(() => {})),
}));

describe('AuthGuard', () => {
    beforeEach(() => {
        useAuthStore.setState({
            token: 'token',
            userInfo: null,
            systemAdmin: false,
            currentGroup: null,
            accessibleGroups: [],
            permissions: [],
            contextLoaded: false,
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('does not show a full-page loading card while auth context is pending', () => {
        render(
            <MemoryRouter>
                <Routes>
                    <Route element={<AuthGuard />}>
                        <Route index element={<div>workspace</div>} />
                    </Route>
                </Routes>
            </MemoryRouter>,
        );

        expect(screen.queryByText('页面加载中')).toBeNull();
        expect(screen.queryByText('正在按需加载当前页面资源')).toBeNull();
        expect(screen.queryByText('workspace')).toBeNull();
    });
});

describe('withRouteSuspense', () => {
    afterEach(() => {
        cleanup();
    });

    it('does not fall back to a full-page loading card', () => {
        const Never = lazy(() => new Promise<{ default: () => null }>(() => {}));

        render(withRouteSuspense(<Never />));

        expect(screen.queryByText('页面加载中')).toBeNull();
        expect(screen.queryByText('正在按需加载当前页面资源')).toBeNull();
    });
});
