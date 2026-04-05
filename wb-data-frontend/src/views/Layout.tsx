import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { Database, FolderOpen, Home, Layers, LogOut, Search, Users } from 'lucide-react';
import { useAuthStore } from '../utils/auth';
import { getAuthContext } from '../api/auth';
import { getDataSourcePage } from '../api/datasource';
import { TopProgressBar } from '../components/loading/TopProgressBar';
import { buildDataSourcePageQueryKey, DEFAULT_PAGE_SIZE } from './datasources/config';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../components/ui/select';
import {
    loadDashboardModule,
    loadDataSourceListModule,
    loadQueryModule,
    loadUserListModule,
} from '../router/routeModules';
import { useDelayedBusy } from '../hooks/useDelayedBusy';
import { loadQueryEditorModule } from './queryEditorModule';
import './Layout.css';

interface NavItem {
    path: string;
    label: string;
    icon: LucideIcon;
    end?: boolean;
}

export default function Layout() {
    const userInfo = useAuthStore((s) => s.userInfo);
    const currentGroup = useAuthStore((s) => s.currentGroup);
    const accessibleGroups = useAuthStore((s) => s.accessibleGroups);
    const permissions = useAuthStore((s) => s.permissions);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);
    const queryClient = useQueryClient();
    const location = useLocation();
    const clearAuth = useAuthStore((s) => s.clearAuth);
    const [switchingGroup, setSwitchingGroup] = useState(false);

    const navItems = useMemo(() => {
        const hasPermission = (perm: string) => systemAdmin || permissions.includes(perm);

        const items: NavItem[] = [
            { path: '/', label: '首页', icon: Home, end: true },
        ];

        if (hasPermission('datasource.read')) {
            items.push({ path: '/datasources', label: '数据源管理', icon: Database });
        }

        if (hasPermission('query.use')) {
            items.push({ path: '/query', label: '自助查询', icon: Search });
        }

        if (systemAdmin) {
            items.push({ path: '/users', label: '用户管理', icon: Users });
        }

        return items;
    }, [permissions, systemAdmin]);

    const handleGroupChange = useCallback(async (groupId: number) => {
        if (groupId === currentGroup?.id) return;
        setSwitchingGroup(true);
        try {
            const ctx = await getAuthContext(groupId);
            useAuthStore.getState().setAuthContext(ctx);
        } catch {
            /* noop — keep current group on failure */
        } finally {
            setSwitchingGroup(false);
        }
    }, [currentGroup?.id]);

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
                return;
            }

            if (path === '/users') {
                void loadUserListModule();
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
                        {navItems.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                                end={item.end}
                                {...bindNavIntent(item.path)}
                            >
                                <item.icon size={18} />
                                <span>{item.label}</span>
                            </NavLink>
                        ))}
                    </nav>
                </div>
                <div className="navbar-right">
                    {accessibleGroups.length > 1 && currentGroup && (
                        <Select
                            value={currentGroup.id}
                            onValueChange={(val: number | null) => { if (val != null) handleGroupChange(val); }}
                            disabled={switchingGroup}
                            items={accessibleGroups.map((g) => ({ value: g.id, label: g.name }))}
                        >
                            <SelectTrigger
                                size="sm"
                                className="group-switcher-trigger"
                            >
                                <FolderOpen className="size-3.5 text-muted-foreground" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                                {accessibleGroups.map((g) => (
                                    <SelectItem key={g.id} value={g.id}>
                                        {g.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    {accessibleGroups.length === 1 && currentGroup && (
                        <div className="group-switcher-static">
                            <FolderOpen size={14} className="text-muted-foreground" />
                            <span>{currentGroup.name}</span>
                        </div>
                    )}
                    <div className="user-profile">
                        <span className="user-avater">{userInfo?.displayName?.charAt(0).toUpperCase() || '?'}</span>
                        <span>{userInfo?.displayName || userInfo?.username || '未知用户'}</span>
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
