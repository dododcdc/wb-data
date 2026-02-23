import { Outlet, NavLink } from 'react-router-dom';
import { Database, Home, Layers } from 'lucide-react';
import { useUserStore } from '../store';
import './Layout.css';

export default function Layout() {
    const { userInfo } = useUserStore();
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
                        <NavLink to="/" className="nav-item" end>
                            <Home size={18} />
                            <span>仪表盘</span>
                        </NavLink>
                        <NavLink to="/datasources" className="nav-item">
                            <Database size={18} />
                            <span>数据源管理</span>
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
                <div className="content-area">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
