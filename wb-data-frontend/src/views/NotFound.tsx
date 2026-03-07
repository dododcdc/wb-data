import { Home, MoveLeft } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './RouteState.css';

export default function NotFound() {
    const location = useLocation();
    const navigate = useNavigate();

    return (
        <div className="route-state-shell">
            <section className="route-state-card route-state-card-notfound">
                <div className="route-state-code">404</div>
                <div className="route-state-copy">
                    <span className="route-state-kicker">Missing Route</span>
                    <h1>这个页面不存在</h1>
                    <p>
                        你访问的路径 <code>{location.pathname}</code> 当前没有对应页面。
                        这通常是旧链接失效，或者地址输错了。
                    </p>
                </div>
                <div className="route-state-actions">
                    <button className="route-state-secondary" onClick={() => navigate(-1)} type="button">
                        <MoveLeft size={16} />
                        返回上一页
                    </button>
                    <Link className="route-state-primary" to="/">
                        <Home size={16} />
                        返回首页
                    </Link>
                </div>
            </section>
        </div>
    );
}
