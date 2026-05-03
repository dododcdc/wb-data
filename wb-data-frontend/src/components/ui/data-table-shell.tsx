import { ReactNode } from 'react';
import './data-table-shell.css';

interface DataTableShellProps {
    dataLength: number;
    isRefreshing: boolean;
    errorMessage?: string;
    emptyIcon?: ReactNode;
    emptyTitle?: ReactNode;
    emptyDescription?: ReactNode;
    children: ReactNode;
    className?: string;
}

export function DataTableShell(props: DataTableShellProps) {
    const {
        dataLength,
        isRefreshing,
        errorMessage,
        emptyIcon,
        emptyTitle = '暂无数据',
        emptyDescription,
        children,
        className = '',
    } = props;

    if (errorMessage && dataLength === 0) {
        return (
            <div className="dt-error">
                <strong>列表加载失败</strong>
                <p>{errorMessage}</p>
            </div>
        );
    }

    if (dataLength === 0) {
        return (
            <div className="dt-empty">
                {emptyIcon && <div className="dt-empty-icon">{emptyIcon}</div>}
                <h3>{emptyTitle}</h3>
                {emptyDescription && <p>{emptyDescription}</p>}
            </div>
        );
    }

    return (
        <div className={`dt-shell ${isRefreshing ? 'is-refreshing' : ''} ${className}`}>
            {errorMessage ? (
                <div className="dt-inline-error" role="alert">
                    <strong>最新一次刷新失败</strong>
                    <p>{errorMessage}</p>
                </div>
            ) : null}
            <div className="dt-progress" aria-hidden="true" />
            <div className="dt-scroll">
                {children}
            </div>
            <div className="dt-refresh-overlay" aria-hidden={!isRefreshing}>
                <div className="dt-refresh-pill">
                    <span className="dt-refresh-dot" />
                    正在更新列表
                </div>
            </div>
        </div>
    );
}
