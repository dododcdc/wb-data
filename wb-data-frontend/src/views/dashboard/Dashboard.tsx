import { LayoutDashboard, Database, Search, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Dashboard.css';

export default function Dashboard() {
    return (
        <div className="dashboard-page animate-enter">
            <div className="dashboard-hero">
                <div className="dashboard-hero-icon">
                    <LayoutDashboard size={32} />
                </div>
                <h1 className="dashboard-title">欢迎使用 WB Data</h1>
                <p className="dashboard-subtitle">
                    连接您的数据源，编写 SQL 查询，探索数据洞察
                </p>
            </div>
            <div className="dashboard-cards">
                <Link to="/datasources" className="dashboard-card animate-enter animate-enter-delay-1">
                    <div className="dashboard-card-icon">
                        <Database size={22} />
                    </div>
                    <div className="dashboard-card-content">
                        <h3>数据源管理</h3>
                        <p>配置和管理您的数据库连接</p>
                    </div>
                    <ArrowRight size={18} className="dashboard-card-arrow" />
                </Link>
                <Link to="/query" className="dashboard-card animate-enter animate-enter-delay-2">
                    <div className="dashboard-card-icon accent">
                        <Search size={22} />
                    </div>
                    <div className="dashboard-card-content">
                        <h3>自助查询</h3>
                        <p>编写 SQL，探索数据</p>
                    </div>
                    <ArrowRight size={18} className="dashboard-card-arrow" />
                </Link>
            </div>
        </div>
    );
}