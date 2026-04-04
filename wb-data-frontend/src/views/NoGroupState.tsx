import { FolderOpen } from 'lucide-react';
import './RouteState.css';

export default function NoGroupState() {
    return (
        <div className="route-state-shell">
            <section className="route-state-card animate-enter">
                <div className="route-state-code">
                    <FolderOpen size={52} />
                </div>
                <div className="route-state-copy">
                    <span className="route-state-kicker">No Group</span>
                    <h1>你还未加入任何项目组</h1>
                    <p>请联系系统管理员将你加入项目组后即可开始使用。</p>
                </div>
            </section>
        </div>
    );
}
