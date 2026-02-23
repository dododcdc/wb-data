import { LayoutDashboard } from 'lucide-react';
import './Dashboard.css';

export default function Dashboard() {
    return (
        <div className="dashboard-placeholder">
            <div className="placeholder-content">
                <LayoutDashboard size={64} className="placeholder-icon" />
                <h2>仪表盘</h2>
                <p>功能正在开发中，敬请期待...</p>
                <div className="placeholder-status">待开发</div>
            </div>
        </div>
    );
}
