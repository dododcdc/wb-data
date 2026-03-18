import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import './RouteState.css';

function getErrorCopy(error: unknown) {
    if (isRouteErrorResponse(error)) {
        return {
            code: String(error.status),
            title: error.status === 404 ? '页面不存在' : '页面加载失败',
            message: error.statusText || '当前页面发生了未预期的路由错误。',
        };
    }

    if (error instanceof Error) {
        return {
            code: '500',
            title: '发生了运行时错误',
            message: error.message || '应用在渲染当前页面时失败了。',
        };
    }

    return {
        code: '500',
        title: '发生了未知错误',
        message: '应用在渲染当前页面时失败了，请刷新后重试。',
    };
}

export default function RouteErrorPage() {
    const error = useRouteError();
    const copy = getErrorCopy(error);

    return (
        <div className="route-error-screen">
            <section className="route-state-card route-state-card-error animate-enter">
                <div className="route-state-code">{copy.code}</div>
                <div className="route-state-copy">
                    <span className="route-state-kicker">Application Error</span>
                    <h1>{copy.title}</h1>
                    <p>{copy.message}</p>
                </div>
                <div className="route-state-actions">
                    <button className="route-state-secondary" onClick={() => window.location.reload()} type="button">
                        <RefreshCw size={16} />
                        刷新页面
                    </button>
                    <Link className="route-state-primary" to="/datasources">
                        <AlertTriangle size={16} />
                        返回安全页面
                    </Link>
                </div>
            </section>
        </div>
    );
}
