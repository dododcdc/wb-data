/* eslint-disable react-refresh/only-export-components */
import { Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthContext } from '../hooks/useAuthContext';
import { useAuthStore } from '../utils/auth';
import { getErrorMessage } from '../utils/error';
import { Button } from '../components/ui/button';

export function withRouteSuspense(element: ReactNode, fallback: ReactNode = null) {
    return <Suspense fallback={fallback}>{element}</Suspense>;
}

export function AuthGuard() {
    const location = useLocation();
    const token = useAuthStore((s) => s.token);
    const contextLoaded = useAuthStore((s) => s.contextLoaded);
    const contextQuery = useAuthContext();

    if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
    if (!contextLoaded) {
        if (contextQuery.isError && !contextQuery.isFetching) {
            return (
                <div role="alert">
                    <p>{getErrorMessage(contextQuery.error, '权限信息读取失败，请重试')}</p>
                    <Button variant="outline" onClick={() => { void contextQuery.refetch(); }}>重试</Button>
                </div>
            );
        }
        return (
            <div role="status">
                <span className="sr-only">正在进入工作台</span>
            </div>
        );
    }
    return <Outlet />;
}
