import type { Key, ReactNode } from 'react';
import { ListShell, type ListState } from './ListShell';

export interface DataListColumn<T> {
    key: string;
    header: ReactNode;
    cell: (row: T) => ReactNode;
    primary?: boolean;
    mono?: boolean;
    truncate?: boolean;
    align?: 'left' | 'right';
    width?: string | number;
}

interface DataListProps<T> {
    rows: T[];
    columns: DataListColumn<T>[];
    rowKey: (row: T, index: number) => Key;
    ariaLabel: string;
    minWidth?: string;
    className?: string;
    onRowClick?: (row: T) => void;
    rowAriaLabel?: (row: T) => string;
    state?: ListState;
    isRefreshing?: boolean;
    errorMessage?: string;
    hasFooter?: boolean;
    emptyIcon?: ReactNode;
    emptyTitle?: ReactNode;
    emptyDescription?: ReactNode;
    emptyAction?: ReactNode;
    filteredEmptyTitle?: ReactNode;
    filteredEmptyDescription?: ReactNode;
    filteredEmptyAction?: ReactNode;
    errorAction?: ReactNode;
}

export function DataList<T>({
    rows,
    columns,
    rowKey,
    ariaLabel,
    minWidth,
    className,
    onRowClick,
    rowAriaLabel,
    state = 'ready',
    isRefreshing = false,
    errorMessage,
    hasFooter = false,
    emptyIcon,
    emptyTitle,
    emptyDescription,
    emptyAction,
    filteredEmptyTitle,
    filteredEmptyDescription,
    filteredEmptyAction,
    errorAction,
}: DataListProps<T>) {
    return (
        <ListShell
            state={state}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            hasFooter={hasFooter}
            emptyIcon={emptyIcon}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            emptyAction={emptyAction}
            filteredEmptyTitle={filteredEmptyTitle}
            filteredEmptyDescription={filteredEmptyDescription}
            filteredEmptyAction={filteredEmptyAction}
            errorAction={errorAction}
            className={className}
        >
            {state === 'loading' ? (
                <div className="wb-list-skeleton" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, rowIndex) => (
                        <div
                            className="wb-list-skeleton-row"
                            key={rowIndex}
                            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
                        >
                            {columns.map((column) => <span key={column.key} />)}
                        </div>
                    ))}
                </div>
            ) : (
                <table className="wb-list-table" aria-label={ariaLabel} style={{ minWidth }}>
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column.key}
                                    style={{ width: column.width, textAlign: column.align }}
                                >
                                    {column.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr
                                key={rowKey(row, rowIndex)}
                                className={onRowClick ? 'is-clickable' : undefined}
                                tabIndex={onRowClick ? 0 : undefined}
                                aria-label={onRowClick ? rowAriaLabel?.(row) : undefined}
                                onClick={onRowClick ? () => onRowClick(row) : undefined}
                                onKeyDown={onRowClick ? (event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    onRowClick(row);
                                } : undefined}
                            >
                                {columns.map((column) => (
                                    <td
                                        key={column.key}
                                        className={`${column.primary ? 'wb-list-cell-strong ' : ''}${column.mono ? 'wb-list-cell-mono ' : ''}${column.truncate ? 'wb-list-cell-truncate ' : ''}${column.align === 'right' ? 'wb-list-cell-right' : ''}`.trim()}
                                    >
                                        {column.cell(row)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </ListShell>
    );
}
