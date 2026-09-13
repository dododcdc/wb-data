/* eslint-disable react-refresh/only-export-components */
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { getAuthContext } from '../api/auth';
import { useAuthStore } from '../utils/auth';

export function withRouteSuspense(element: ReactNode, fallback: ReactNode = null) {
    return <Suspense fallback={fallback}>{element}</Suspense>;
}

export function AuthGuard() {
    const token = useAuthStore((s) => s.token);
    const contextLoaded = useAuthStore((s) => s.contextLoaded);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!token || useAuthStore.getState().contextLoaded) return;

        let cancelled = false;
        getAuthContext()
            .then((ctx) => {
                if (!cancelled) useAuthStore.getState().setAuthContext(ctx);
            })
            .catch(() => {
                if (!cancelled) {
                    useAuthStore.getState().clearAuth();
                    setFailed(true);
                }
            });
        return () => { cancelled = true; };
    }, [token, contextLoaded]);

    if (!token || failed) return <Navigate to="/login" replace />;
    if (!contextLoaded) {
        return (
            <div role="status">
                <span className="sr-only">正在进入工作台</span>
            </div>
        );
    }
    return <Outlet />;
}
