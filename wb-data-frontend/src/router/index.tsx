import { createBrowserRouter } from 'react-router-dom';
import Layout from '../views/Layout';
import DataSourceList from '../views/DataSourceList';
import Dashboard from '../views/Dashboard';

const router = createBrowserRouter([
    {
        path: '/',
        element: <Layout />,
        children: [
            {
                index: true,
                element: <Dashboard />,
            },
            {
                path: 'datasources',
                element: <DataSourceList />,
            },
        ],
    },
]);

export default router;
