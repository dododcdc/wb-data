import type { ReactNode } from 'react';
import './list.css';

export type ListState = 'ready' | 'loading' | 'empty' | 'filtered-empty' | 'error';

interface ListShellProps {
    children?: ReactNode;
    state?: ListState;
    isRefreshing?: boolean;
    errorMessage?: string;
    hasFooter?: boolean;
    className?: string;
    emptyIcon?: ReactNode;
    emptyTitle?: ReactNode;
    emptyDescription?: ReactNode;
    emptyAction?: ReactNode;
    filteredEmptyTitle?: ReactNode;
    filteredEmptyDescription?: ReactNode;
    filteredEmptyAction?: ReactNode;
    errorAction?: ReactNode;
}

export function ListShell({
    children,
    state = 'ready',
    isRefreshing = false,
    errorMessage,
    hasFooter = false,
    className = '',
    emptyIcon,
    emptyTitle = '暂无数据',
    emptyDescription,
    emptyAction,
    filteredEmptyTitle = '没有匹配的结果',
    filteredEmptyDescription = '试着清空筛选条件后重新查看。',
    filteredEmptyAction,
    errorAction,
}: ListShellProps) {
    const showsContent = state === 'ready' || state === 'loading';

    return (
        <div className={`wb-list-panel${hasFooter ? ' has-footer' : ''}${isRefreshing ? ' is-refreshing' : ''}${className ? ` ${className}` : ''}`}>
            <div className="wb-list-progress" aria-hidden="true" />
            {isRefreshing ? <span className="sr-only" role="status">正在更新列表</span> : null}
            {state === 'ready' && errorMessage ? (
                <div className="wb-list-inline-error" role="alert">
                    <div>
                        <strong>最新一次刷新失败</strong>
                        <p>{errorMessage}</p>
                    </div>
                    {errorAction}
                </div>
            ) : null}
            {showsContent ? (
                <div className="wb-list-scroll" aria-busy={state === 'loading'}>
                    {children}
                </div>
            ) : state === 'error' ? (
                <div className="wb-list-state is-error" role="alert">
                    <h4>列表加载失败</h4>
                    {errorMessage ? <p>{errorMessage}</p> : null}
                    {errorAction}
                </div>
            ) : (
                <div className="wb-list-state">
                    {state === 'empty' ? emptyIcon : null}
                    <h4>{state === 'filtered-empty' ? filteredEmptyTitle : emptyTitle}</h4>
                    <p>{state === 'filtered-empty' ? filteredEmptyDescription : emptyDescription}</p>
                    {state === 'filtered-empty' ? filteredEmptyAction : emptyAction}
                </div>
            )}
        </div>
    );
}
