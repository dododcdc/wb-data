/* eslint-disable react-refresh/only-export-components */
import { Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { LogOut, RefreshCw } from 'lucide-react';

import { useAuthContext } from '../hooks/useAuthContext';
import { useAuthStore } from '../utils/auth';
import { getErrorMessage } from '../utils/error';
import '../views/core/RouteState.css';

export function withRouteSuspense(element: ReactNode, fallback: ReactNode = null) {
    return <Suspense fallback={fallback}>{element}</Suspense>;
}

function getAuthErrorCopy(error: unknown) {
    if (isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 403) {
            return {
                code: '403',
                kicker: 'Access Denied',
                title: '无权限访问系统',
                message: getErrorMessage(error, '当前账号未被分配系统访问权限，请联系管理员。'),
            };
        }
        if (status && status >= 500) {
            return {
                code: String(status),
                kicker: 'Server Error',
                title: '服务暂时不可用',
                message: getErrorMessage(error, '未能获取用户权限上下文，请确认后端服务已正常启动。'),
            };
        }
        if (!error.response) {
            return {
                code: 'Net',
                kicker: 'Network Error',
                title: '无法连接到服务器',
                message: '未能与后端服务建立连接，请检查网络或确认服务运行状态。',
            };
        }
    }

    return {
        code: '500',
        kicker: 'Service Error',
        title: '权限初始化失败',
        message: getErrorMessage(error, '未能加载用户权限信息，请稍后重试。'),
    };
}

export function AuthGuard() {
    const location = useLocation();
    const token = useAuthStore((s) => s.token);
    const contextLoaded = useAuthStore((s) => s.contextLoaded);
    const clearAuth = useAuthStore((s) => s.clearAuth);
    const contextQuery = useAuthContext();

    if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
    if (!contextLoaded) {
        if (contextQuery.isError && !contextQuery.isFetching) {
            const copy = getAuthErrorCopy(contextQuery.error);
            return (
                <div className="route-error-screen" role="alert">
                    <section className="route-state-card route-state-card-error animate-enter">
                        <div className="route-state-code">{copy.code}</div>
                        <div className="route-state-copy">
                            <span className="route-state-kicker">{copy.kicker}</span>
                            <h1>{copy.title}</h1>
                            <p>{copy.message}</p>
                        </div>
                        <div className="route-state-actions">
                            <button
                                className="route-state-secondary"
                                onClick={() => { void contextQuery.refetch(); }}
                                type="button"
                            >
                                <RefreshCw size={16} />
                                重试
                            </button>
                            <button
                                className="route-state-primary"
                                onClick={() => { clearAuth(); }}
                                type="button"
                            >
                                <LogOut size={16} />
                                重新登录
                            </button>
                        </div>
                    </section>
                </div>
            );
        }
        return (
            <div role="status">
                <span className="sr-only">正在进入工作台</span>
            </div>
        );
    }
    return <Outlet />;
}
