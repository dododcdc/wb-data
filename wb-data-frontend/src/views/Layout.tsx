import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database, Home, Layers, LogOut, Search } from 'lucide-react';
import { useAuthStore } from '../utils/auth';
import { getDataSourcePage } from '../api/datasource';
import { TopProgressBar } from '../components/loading/TopProgressBar';
import { useUserStore } from '../store';
import { buildDataSourcePageQueryKey, DEFAULT_PAGE_SIZE } from './datasources/config';
import {
    loadDashboardModule,
    loadDataSourceListModule,
    loadQueryModule,
} from '../router/routeModules';
import { useDelayedBusy } from '../hooks/useDelayedBusy';
import { loadQueryEditorModule } from './queryEditorModule';
import './Layout.css';

export default function Layout() {
    const { userInfo } = useUserStore();
    const queryClient = useQueryClient();
    const location = useLocation();
    const clearAuth = useAuthStore((s) => s.clearAuth);

    const handleLogout = () => {
        clearAuth();
    };
    const isQueryPage = location.pathname.startsWith('/query');
    const [routeIntent, setRouteIntent] = useState<string | null>(null);

    const routeBusy = Boolean(routeIntent && routeIntent !== location.pathname);
    const showRouteProgress = useDelayedBusy(routeBusy, { delayMs: 110, minVisibleMs: 260 });
    const routeProgressSettling = Boolean(routeIntent && routeIntent === location.pathname && showRouteProgress);

    useEffect(() => {
        if (!routeIntent || routeIntent !== location.pathname) return;

        const clearTimer = window.setTimeout(() => {
            setRouteIntent(null);
        }, showRouteProgress ? 220 : 0);

        return () => window.clearTimeout(clearTimer);
    }, [location.pathname, routeIntent, showRouteProgress]);

    const warmRoute = useMemo(() => {
        return (path: string) => {
            if (path === '/') {
                void loadDashboardModule();
                return;
            }

            if (path === '/datasources') {
                void loadDataSourceListModule();
                void queryClient.prefetchQuery({
                    queryKey: buildDataSourcePageQueryKey({
                        currentPage: 1,
                        pageSize: DEFAULT_PAGE_SIZE,
                        keyword: '',
                    }),
                    queryFn: () => getDataSourcePage({
                        page: 1,
                        size: DEFAULT_PAGE_SIZE,
                    }),
                });
                return;
            }

            if (path === '/query') {
                void loadQueryModule();
                void loadQueryEditorModule();
            }
        };
    }, [queryClient]);

    useEffect(() => {
        warmRoute('/query');
    }, [warmRoute]);

    const bindNavIntent = (path: string) => ({
        onClick: () => {
            if (path === location.pathname) return;
            warmRoute(path);
            setRouteIntent(path);
        },
        onFocus: () => warmRoute(path),
        onMouseEnter: () => warmRoute(path),
    });

    return (
        <div className="layout-container">
            <header className="global-navbar">
                <TopProgressBar visible={showRouteProgress} settling={routeProgressSettling} />
                <div className="navbar-left">
                    <div className="logo-section">
                        <div className="logo-wrapper">
                            <Layers size={18} className="logo-icon" />
                        </div>
                        <h2>WB Data</h2>
                    </div>
                    <nav className="nav-menu">
                        <NavLink
                            to="/"
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                            end
                            {...bindNavIntent('/')}
                        >
                            <Home size={18} />
                            <span>首页</span>
                        </NavLink>
                        <NavLink
                            to="/datasources"
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                            {...bindNavIntent('/datasources')}
                        >
                            <Database size={18} />
                            <span>数据源管理</span>
                        </NavLink>
                        <NavLink
                            to="/query"
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                            {...bindNavIntent('/query')}
                        >
                            <Search size={18} />
                            <span>自助查询</span>
                        </NavLink>
                    </nav>
                </div>
                <div className="navbar-right">
                    <div className="user-profile">
                        <span className="user-avater">A</span>
                        <span>{userInfo?.username || 'admin'}</span>
                    </div>
                    <button className="logout-btn" onClick={handleLogout} title="退出登录">
                        <LogOut size={16} />
                    </button>
                </div>
            </header>
            <main className="main-content">
                <div className={`content-area ${isQueryPage ? 'full-bleed' : ''}`}>
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
