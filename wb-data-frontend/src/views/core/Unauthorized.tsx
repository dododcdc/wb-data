import { Home, ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import './RouteState.css';

export default function Unauthorized() {
    return (
        <div className="route-state-shell">
            <section className="route-state-card animate-enter">
                <div className="route-state-code">
                    <ShieldX size={52} />
                </div>
                <div className="route-state-copy">
                    <span className="route-state-kicker">Forbidden</span>
                    <h1>你没有访问此页面的权限</h1>
                    <p>如需访问，请联系项目组管理员调整权限。</p>
                </div>
                <div className="route-state-actions">
                    <Link className="route-state-primary" to="/">
                        <Home size={16} />
                        返回首页
                    </Link>
                </div>
            </section>
        </div>
    );
}
