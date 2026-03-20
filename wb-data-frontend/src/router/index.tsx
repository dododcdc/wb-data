import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import Layout from '../views/Layout';
import RouteErrorPage from '../views/RouteErrorPage';
import RouteLoadingPage from '../views/RouteLoadingPage';

const Dashboard = lazy(() => import('../views/Dashboard'));
const DataSourceList = lazy(() => import('../views/DataSourceList'));
const Query = lazy(() => import('../views/Query'));
const NotFound = lazy(() => import('../views/NotFound'));

function withRouteSuspense(element: ReactNode) {
    return <Suspense fallback={<RouteLoadingPage />}>{element}</Suspense>;
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
                element: withRouteSuspense(<DataSourceList />),
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
