import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import DataSourceListSkeleton from '../views/datasources/DataSourceListSkeleton';
import Layout from '../views/Layout';
import RouteErrorPage from '../views/RouteErrorPage';
import RouteLoadingPage from '../views/RouteLoadingPage';
import {
    loadDashboardModule,
    loadDataSourceListModule,
    loadNotFoundModule,
    loadQueryModule,
} from './routeModules';

const Dashboard = lazy(loadDashboardModule);
const DataSourceList = lazy(loadDataSourceListModule);
const Query = lazy(loadQueryModule);
const NotFound = lazy(loadNotFoundModule);

function withRouteSuspense(element: ReactNode, fallback: ReactNode = <RouteLoadingPage />) {
    return <Suspense fallback={fallback}>{element}</Suspense>;
}

const router = createBrowserRouter([
    {
        path: '/',
        element: <Layout />,
        errorElement: <RouteErrorPage />,
        children: [
            {
                index: true,
                element: withRouteSuspense(<Dashboard />),
            },
            {
                path: 'datasources',
                element: withRouteSuspense(<DataSourceList />, <DataSourceListSkeleton />),
            },
            {
                path: 'query',
                element: withRouteSuspense(<Query />),
            },
            {
                path: '*',
                element: withRouteSuspense(<NotFound />),
            },
        ],
    },
]);

export default router;
