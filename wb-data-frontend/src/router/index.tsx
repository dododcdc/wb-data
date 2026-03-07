import { createBrowserRouter } from 'react-router-dom';
import Layout from '../views/Layout';
import DataSourceList from '../views/DataSourceList';
import Dashboard from '../views/Dashboard';
import NotFound from '../views/NotFound';
import RouteErrorPage from '../views/RouteErrorPage';

const router = createBrowserRouter([
    {
        path: '/',
        element: <Layout />,
        errorElement: <RouteErrorPage />,
        children: [
            {
                index: true,
                element: <Dashboard />,
            },
            {
                path: 'datasources',
                element: <DataSourceList />,
            },
            {
                path: '*',
                element: <NotFound />,
            },
        ],
    },
]);

export default router;
