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
    selectable?: boolean;
    selectedKeys?: Set<Key>;
    onToggleRow?: (key: Key) => void;
    onToggleAll?: (checked: boolean) => void;
    isRowSelectable?: (row: T) => boolean;
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
    selectable = false,
    selectedKeys,
    onToggleRow,
    onToggleAll,
    isRowSelectable,
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
    const selectableKeys = selectable
        ? rows.flatMap((row, rowIndex) => (
            !isRowSelectable || isRowSelectable(row) ? [rowKey(row, rowIndex)] : []
        ))
        : [];
    const selectedSelectableCount = selectable && selectedKeys
        ? selectableKeys.filter((key) => selectedKeys.has(key)).length
        : 0;
    const allSelected = selectableKeys.length > 0 && selectedSelectableCount === selectableKeys.length;
    const someSelected = selectedSelectableCount > 0 && !allSelected;

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
                            style={{ gridTemplateColumns: `repeat(${columns.length + (selectable ? 1 : 0)}, minmax(0, 1fr))` }}
                        >
                            {selectable ? <span /> : null}
                            {columns.map((column) => <span key={column.key} />)}
                        </div>
                    ))}
                </div>
            ) : (
                <table className="wb-list-table" aria-label={ariaLabel} style={{ minWidth }}>
                    <thead>
                        <tr>
                            {selectable ? (
                                <th className="wb-list-checkbox-col" style={{ width: 36 }}>
                                    <input
                                        type="checkbox"
                                        className="wb-list-checkbox"
                                        aria-label="全选当前页"
                                        checked={allSelected}
                                        ref={(el) => {
                                            if (el) el.indeterminate = someSelected;
                                        }}
                                        disabled={selectableKeys.length === 0}
                                        onChange={(event) => onToggleAll?.(event.target.checked)}
                                    />
                                </th>
                            ) : null}
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
                        {rows.map((row, rowIndex) => {
                            const key = rowKey(row, rowIndex);
                            const rowCanSelect = selectable && (!isRowSelectable || isRowSelectable(row));
                            const rowChecked = Boolean(selectable && selectedKeys?.has(key));
                            return (
                                <tr
                                    key={key}
                                    className={`${onRowClick ? 'is-clickable ' : ''}${rowChecked ? 'is-selected' : ''}`.trim() || undefined}
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
                                    {selectable ? (
                                        <td
                                            className="wb-list-checkbox-col"
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <input
                                                type="checkbox"
                                                className="wb-list-checkbox"
                                                aria-label={`选择第 ${rowIndex + 1} 行`}
                                                checked={rowChecked}
                                                disabled={!rowCanSelect}
                                                onChange={() => onToggleRow?.(key)}
                                            />
                                        </td>
                                    ) : null}
                                    {columns.map((column) => (
                                        <td
                                            key={column.key}
                                            className={`${column.primary ? 'wb-list-cell-strong ' : ''}${column.mono ? 'wb-list-cell-mono ' : ''}${column.truncate ? 'wb-list-cell-truncate ' : ''}${column.align === 'right' ? 'wb-list-cell-right' : ''}`.trim()}
                                        >
                                            {column.cell(row)}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </ListShell>
    );
}
