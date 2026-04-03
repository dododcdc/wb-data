import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../utils/auth';
import DashboardSkeleton from '../views/DashboardSkeleton';
import DataSourceListSkeleton from '../views/datasources/DataSourceListSkeleton';
import Layout from '../views/Layout';
import QuerySkeleton from '../views/QuerySkeleton';
import RouteErrorPage from '../views/RouteErrorPage';
import RouteLoadingPage from '../views/RouteLoadingPage';
import {
    loadDashboardModule,
    loadDataSourceListModule,
    loadLoginModule,
    loadNotFoundModule,
    loadQueryModule,
} from './routeModules';

const Login = lazy(loadLoginModule);
const Dashboard = lazy(loadDashboardModule);
const DataSourceList = lazy(loadDataSourceListModule);
const Query = lazy(loadQueryModule);
const NotFound = lazy(loadNotFoundModule);

function withRouteSuspense(element: ReactNode, fallback: ReactNode = <RouteLoadingPage />) {
    return <Suspense fallback={fallback}>{element}</Suspense>;
}

function AuthGuard() {
    const token = useAuthStore((s) => s.token);
    if (!token) return <Navigate to="/login" replace />;
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
                        path: 'datasources',
                        element: withRouteSuspense(<DataSourceList />, <DataSourceListSkeleton />),
                    },
                    {
                        path: 'query',
                        element: withRouteSuspense(<Query />, <QuerySkeleton />),
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
