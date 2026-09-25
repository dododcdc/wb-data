import { FolderOpen, LogOut } from 'lucide-react';
import { isAxiosError } from 'axios';
import { logout } from '../../api/auth';
import { useAuthStore } from '../../utils/auth';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import './RouteState.css';

export default function NoGroupState() {
    const { showError } = useOperationFeedback();

    const handleLogout = async () => {
        try {
            await logout();
            useAuthStore.getState().clearAuth();
        } catch (error) {
            if (isAxiosError(error) && error.response?.status === 401) return;
            showError(error, '退出失败', '未能确认服务端注销，请重试。');
        }
    };

    return (
        <div className="route-state-shell">
            <section className="route-state-card animate-enter">
                <div className="route-state-code">
                    <FolderOpen size={52} />
                </div>
                <div className="route-state-copy">
                    <span className="route-state-kicker">No Group</span>
                    <h1>你还未加入任何项目组</h1>
                    <p>请联系系统管理员将你加入项目组后即可开始使用，或退出后切换账号。</p>
                </div>
                <div className="route-state-actions">
                    <button className="route-state-secondary" onClick={() => { void handleLogout(); }} type="button">
                        <LogOut size={16} />
                        退出登录
                    </button>
                </div>
            </section>
        </div>
    );
}
