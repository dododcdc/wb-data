import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Database, Home, Layers } from 'lucide-react';
import { useUserStore } from '../store';
import './Layout.css';

export default function Layout() {
    const { userInfo } = useUserStore();
    const location = useLocation();
    const isQueryPage = location.pathname.startsWith('/query');

    return (
        <div className="layout-container">
            <header className="global-navbar">
                <div className="navbar-left">
                    <div className="logo-section">
                        <div className="logo-wrapper">
                            <Layers size={24} className="logo-icon" />
                        </div>
                        <h2>WB Data</h2>
                    </div>
                    <nav className="nav-menu">
                        <NavLink
                            to="/"
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                            end
                        >
                            <Home size={18} />
                            <span>首页</span>
                        </NavLink>
                        <NavLink
                            to="/datasources"
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                        >
                            <Database size={18} />
                            <span>数据源管理</span>
                        </NavLink>
                        <NavLink
                            to="/query"
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                        >
                            <Layers size={18} />
                            <span>自助查询</span>
                        </NavLink>
                    </nav>
                </div>
                <div className="navbar-right">
                    <div className="user-profile">
                        <span className="user-avater">A</span>
                        <span>{userInfo?.username || 'admin'}</span>
                    </div>
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
