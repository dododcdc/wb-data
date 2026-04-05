import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, Database, FolderOpen, Home, Layers, LogOut, Search, Settings, Shield, Users } from 'lucide-react';
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
    loadGroupListModule,
    loadGroupSettingsModule,
    loadQueryModule,
    loadUserListModule,
} from '../router/routeModules';
import { useDelayedBusy } from '../hooks/useDelayedBusy';
import { OperationFeedback } from '../components/OperationFeedback';
import { loadQueryEditorModule } from './queryEditorModule';
import './Layout.css';

interface NavItem {
    kind: 'link';
    path: string;
    label: string;
    icon: LucideIcon;
    end?: boolean;
}

interface NavDropdownItem {
    kind: 'dropdown';
    id: string;
    label: string;
    icon: LucideIcon;
    children: { path: string; label: string; icon: LucideIcon }[];
}

type NavigationItem = NavItem | NavDropdownItem;

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

        const items: NavigationItem[] = [
            { kind: 'link', path: '/', label: '首页', icon: Home, end: true },
        ];

        if (hasPermission('datasource.read')) {
            items.push({ kind: 'link', path: '/datasources', label: '数据源管理', icon: Database });
        }

        if (hasPermission('query.use')) {
            items.push({ kind: 'link', path: '/query', label: '自助查询', icon: Search });
        }

        if (hasPermission('member.read')) {
            items.push({ kind: 'link', path: '/group-settings', label: '成员与设置', icon: Settings });
        }

        if (systemAdmin) {
            items.push({
                kind: 'dropdown',
                id: 'system-admin',
                label: '系统管理',
                icon: Shield,
                children: [
                    { path: '/users', label: '用户管理', icon: Users },
                    { path: '/groups', label: '项目组', icon: FolderOpen },
                ],
            });
        }

        return items;
    }, [permissions, systemAdmin]);

    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

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

    useEffect(() => {
        if (!openDropdown) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpenDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openDropdown]);

    useEffect(() => {
        setOpenDropdown(null);
    }, [location.pathname]);

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

            if (path === '/group-settings') {
                void loadGroupSettingsModule();
                return;
            }

            if (path === '/users') {
                void loadUserListModule();
                return;
            }

            if (path === '/groups') {
                void loadGroupListModule();
            }
        };
    }, [queryClient]);

    const warmDropdownChildren = useCallback((item: NavDropdownItem) => {
        for (const child of item.children) {
            warmRoute(child.path);
        }
    }, [warmRoute]);

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

    const handleDropdownKeyDown = (e: React.KeyboardEvent, item: NavDropdownItem) => {
        const isOpen = openDropdown === item.id;

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isOpen) {
                setOpenDropdown(null);
            } else {
                setOpenDropdown(item.id);
                warmDropdownChildren(item);
            }
            return;
        }

        if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            setOpenDropdown(null);
            return;
        }

        if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            const panel = dropdownRef.current?.querySelector('.nav-dropdown-panel');
            if (!panel) return;
            const items = Array.from(panel.querySelectorAll<HTMLElement>('.nav-dropdown-item'));
            if (items.length === 0) return;
            const focused = document.activeElement as HTMLElement;
            const idx = items.indexOf(focused);
            if (e.key === 'ArrowDown') {
                items[idx < items.length - 1 ? idx + 1 : 0].focus();
            } else {
                items[idx > 0 ? idx - 1 : items.length - 1].focus();
            }
        }
    };

    const handleDropdownItemKeyDown = (e: React.KeyboardEvent, path: string) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            warmRoute(path);
            setRouteIntent(path);
            navigate(path);
            setOpenDropdown(null);
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            setOpenDropdown(null);
            return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const panel = dropdownRef.current?.querySelector('.nav-dropdown-panel');
            if (!panel) return;
            const items = Array.from(panel.querySelectorAll<HTMLElement>('.nav-dropdown-item'));
            const idx = items.indexOf(e.currentTarget as HTMLElement);
            if (e.key === 'ArrowDown') {
                items[idx < items.length - 1 ? idx + 1 : 0].focus();
            } else {
                items[idx > 0 ? idx - 1 : items.length - 1].focus();
            }
        }

        if (e.key === 'Tab') {
            setOpenDropdown(null);
        }
    };

    const isDropdownChildActive = (item: NavDropdownItem) =>
        item.children.some((child) => location.pathname === child.path || location.pathname.startsWith(child.path + '/'));

    return (
        <div className="layout-container">
            <header className="global-navbar">
                <TopProgressBar visible={showRouteProgress} settling={routeProgressSettling} />
                <div className="navbar-left">
                    <div className="logo-section">
                        <Layers size={20} className="logo-icon" />
                        <h2>WB Data</h2>
                    </div>
                    <nav className="nav-menu">
                        {navItems.map((item) =>
                            item.kind === 'link' ? (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                                    end={item.end}
                                    {...bindNavIntent(item.path)}
                                >
                                    <item.icon size={18} className="nav-item-icon" />
                                    <span>{item.label}</span>
                                </NavLink>
                            ) : (
                                <div
                                    key={item.id}
                                    className={`nav-dropdown-wrapper${openDropdown === item.id ? ' open' : ''}`}
                                    ref={dropdownRef}
                                    onMouseEnter={() => {
                                        setOpenDropdown(item.id);
                                        warmDropdownChildren(item);
                                    }}
                                    onMouseLeave={() => setOpenDropdown(null)}
                                >
                                    <button
                                        type="button"
                                        className={`nav-item nav-dropdown-trigger${openDropdown === item.id ? ' open' : ''}${isDropdownChildActive(item) ? ' active' : ''}`}
                                        onClick={() => {
                                            if (openDropdown === item.id) {
                                                setOpenDropdown(null);
                                            } else {
                                                setOpenDropdown(item.id);
                                                warmDropdownChildren(item);
                                            }
                                        }}
                                        onFocus={() => warmDropdownChildren(item)}
                                        onKeyDown={(e) => handleDropdownKeyDown(e, item)}
                                        aria-expanded={openDropdown === item.id}
                                        aria-haspopup="true"
                                    >
                                        <item.icon size={18} className="nav-item-icon" />
                                        <span>{item.label}</span>
                                        <ChevronDown size={14} className={`nav-dropdown-chevron${openDropdown === item.id ? ' open' : ''}`} />
                                    </button>
                                    <div className={`nav-dropdown-panel${openDropdown === item.id ? ' open' : ''}`} role="menu">
                                        <div className="nav-dropdown-panel-inner">
                                            {item.children.map((child) => {
                                                const isChildActive = location.pathname === child.path || location.pathname.startsWith(child.path + '/');
                                                return (
                                                    <button
                                                        key={child.path}
                                                        type="button"
                                                        role="menuitem"
                                                        className={`nav-dropdown-item${isChildActive ? ' active' : ''}`}
                                                        tabIndex={openDropdown === item.id ? 0 : -1}
                                                        onClick={() => {
                                                            warmRoute(child.path);
                                                            setRouteIntent(child.path);
                                                            navigate(child.path);
                                                            setOpenDropdown(null);
                                                        }}
                                                        onKeyDown={(e) => handleDropdownItemKeyDown(e, child.path)}
                                                    >
                                                        <child.icon size={16} className="nav-item-icon" />
                                                        <span>{child.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ),
                        )}
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
            <OperationFeedback />
            <main className="main-content">
                <div className={`content-area ${isQueryPage ? 'full-bleed' : ''}`}>
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
