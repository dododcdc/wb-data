import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { getAuthContext } from '../api/auth';
import { useAuthStore } from '../utils/auth';
import DashboardSkeleton from '../views/dashboard/DashboardSkeleton';
import DataSourceListSkeleton from '../views/datasources/DataSourceListSkeleton';
import Layout from '../views/layout/Layout';
import QuerySkeleton from '../views/query/QuerySkeleton';
import RouteErrorPage from '../views/core/RouteErrorPage';
import RouteLoadingPage from '../views/core/RouteLoadingPage';
import {
    loadDashboardModule,
    loadDataSourceListModule,
    loadExecutionDetailPageModule,
    loadLoginModule,
    loadNoGroupStateModule,
    loadNotFoundModule,
    loadOfflineWorkbenchModule,
    loadQueryModule,
    loadUnauthorizedModule,
    loadUserListModule,
    loadGroupListModule,
    loadGroupSettingsModule,
} from './routeModules';

const Login = lazy(loadLoginModule);
const Dashboard = lazy(loadDashboardModule);
const DataSourceList = lazy(loadDataSourceListModule);
const OfflineWorkbench = lazy(loadOfflineWorkbenchModule);
const ExecutionDetailPage = lazy(loadExecutionDetailPageModule);
const Query = lazy(loadQueryModule);
const UserList = lazy(loadUserListModule);
const GroupList = lazy(loadGroupListModule);
const GroupSettings = lazy(loadGroupSettingsModule);
const NotFound = lazy(loadNotFoundModule);
const NoGroupState = lazy(loadNoGroupStateModule);
const Unauthorized = lazy(loadUnauthorizedModule);

function withRouteSuspense(element: ReactNode, fallback: ReactNode = <RouteLoadingPage />) {
    return <Suspense fallback={fallback}>{element}</Suspense>;
}

function AuthGuard() {
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
    if (!contextLoaded) return <RouteLoadingPage />;
    return <Outlet />;
}

/**
 * Requires a current project group to be set.
 * systemAdmin bypasses — they can access the app even without group membership.
 * Users with no group see the NoGroupState page.
 */
function RequireGroup() {
    const currentGroup = useAuthStore((s) => s.currentGroup);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);

    if (!currentGroup && !systemAdmin) {
        return withRouteSuspense(<NoGroupState />);
    }

    return <Outlet />;
}

/**
 * Requires specific permissions to render children.
 * systemAdmin always passes.
 * Users without the required permission see the Unauthorized page.
 */
function RequirePermission({ required }: { required: string }) {
    const permissions = useAuthStore((s) => s.permissions);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);

    if (!systemAdmin && !permissions.includes(required)) {
        return withRouteSuspense(<Unauthorized />);
    }

    return <Outlet />;
}

/**
 * Requires SYSTEM_ADMIN role to render children.
 * Non-admin users see the Unauthorized page.
 */
function RequireSystemAdmin() {
    const systemAdmin = useAuthStore((s) => s.systemAdmin);

    if (!systemAdmin) {
        return withRouteSuspense(<Unauthorized />);
    }

    return <Outlet />;
}

const router = createBrowserRouter([
    {
        path: '/login',
        element: withRouteSuspense(<Login />),
        errorElement: <RouteErrorPage />,
    },
    {
        path: '/',
        element: <AuthGuard />,
        errorElement: <RouteErrorPage />,
        children: [
            {
                element: <Layout />,
                children: [
                    {
                        index: true,
                        element: withRouteSuspense(<Dashboard />, <DashboardSkeleton />),
                    },
                    {
                        element: <RequireGroup />,
                        children: [
                            {
                                path: 'datasources',
                                element: <RequirePermission required="datasource.read" />,
                                children: [
                                    {
                                        index: true,
                                        element: withRouteSuspense(<DataSourceList />, <DataSourceListSkeleton />),
                                    },
                                ],
                            },
                            {
                                path: 'query',
                                element: <RequirePermission required="query.use" />,
                                children: [
                                    {
                                        index: true,
                                        element: withRouteSuspense(<Query />, <QuerySkeleton />),
                                    },
                                ],
                            },
                            {
                                path: 'offline',
                                element: <RequirePermission required="offline.read" />,
                                children: [
                                    {
                                        index: true,
                                        element: withRouteSuspense(<OfflineWorkbench />),
                                    },
                                    {
                                        path: 'executions/:executionId',
                                        element: withRouteSuspense(<ExecutionDetailPage />),
                                    },
                                ],
                            },
                            {
                                path: 'group-settings',
                                element: <RequirePermission required="member.read" />,
                                children: [
                                    {
                                        index: true,
                                        element: withRouteSuspense(<GroupSettings />),
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        path: 'users',
                        element: <RequireSystemAdmin />,
                        children: [
                            {
                                index: true,
                                element: withRouteSuspense(<UserList />),
                            },
                        ],
                    },
                    {
                        path: 'groups',
                        element: <RequireSystemAdmin />,
                        children: [
                            {
                                index: true,
                                element: withRouteSuspense(<GroupList />),
                            },
                        ],
                    },
                    {
                        path: '*',
                        element: withRouteSuspense(<NotFound />),
                    },
                ],
            },
        ],
    },
]);

export default router;
