import { Loader2 } from 'lucide-react';
import './RouteState.css';

export default function RouteLoadingPage() {
    return (
        <div className="route-state-shell">
            <section className="route-state-card animate-enter">
                <div className="route-state-code">
                    <Loader2 className="animate-spin" size={52} />
                </div>
                <div className="route-state-copy">
                    <span className="route-state-kicker">Loading</span>
                    <h1>页面加载中</h1>
                    <p>正在按需加载当前页面资源，这样可以减少首屏体积。</p>
                </div>
            </section>
        </div>
    );
}
