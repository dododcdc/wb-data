import { useRef, useCallback } from 'react';
import { Search, Loader2, Database, ChevronDown, ChevronRight } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TableSummary, ColumnMetadata } from '../../../api/query';

export interface QuerySidebarProps {
    sidebarCollapsed: boolean;
    selectedDsId: string | null;
    selectedDb: string | null;
    
    // Table search
    tableTotal: number;
    tableKeyword: string;
    setTableKeyword: (keyword: string) => void;
    setTableKeywordCommitted: (keyword: string) => void;

    // Table loading & state
    loadingTables: boolean;
    tables: TableSummary[];
    loadingMoreTables: boolean;
    
    // Table interaction
    expandedTables: Set<string>;
    columnCache: Map<string, ColumnMetadata[]>;
    loadingColumns: Set<string>;
    toggleTableExpand: (tableName: string) => void;
    
    // Scroll handling for infinite loading
    handleTableScrollRef: (node: HTMLDivElement | null) => void;
    tableScrollElement: HTMLDivElement | null;
    handleTableScroll: React.UIEventHandler<HTMLDivElement>;
}

export function QuerySidebar({
    sidebarCollapsed,
    selectedDsId,
    selectedDb,
    tableTotal,
    tableKeyword,
    setTableKeyword,
    setTableKeywordCommitted,
    loadingTables,
    tables,
    loadingMoreTables,
    expandedTables,
    columnCache,
    loadingColumns,
    toggleTableExpand,
    handleTableScrollRef,
    tableScrollElement,
    handleTableScroll,
}: QuerySidebarProps) {
    const composingRef = useRef(false);

    const virtualizer = useVirtualizer({
        count: tables.length,
        getScrollElement: () => tableScrollElement,
        estimateSize: useCallback((index: number) => {
            const table = tables[index];
            if (!table) return 32;
            if (expandedTables.has(table.name)) {
                const cols = columnCache.get(table.name);
                if (loadingColumns.has(table.name)) return 32 + 24;
                if (cols) return 32 + Math.min(cols.length, 50) * 24 + (cols.length > 50 ? 24 : 0);
            }
            return 32;
        }, [tables, expandedTables, columnCache, loadingColumns]),
        overscan: 5,
    });

    return (
        <aside className={`metadata-panel ${sidebarCollapsed ? 'sidebar-hidden' : 'sidebar-visible'}`}>
            <div className="metadata-header">
                <span className="metadata-title">表结构</span>
                {selectedDsId && selectedDb && tableTotal > 0 && (
                    <span className="metadata-total-count">共 {tableTotal} 张表</span>
                )}
            </div>
            {selectedDsId && selectedDb && (
                <div className="metadata-search">
                    <Search size={14} className="metadata-search-icon" />
                    <input
                        type="text"
                        className="metadata-search-input"
                        aria-label="搜索表名"
                        placeholder="搜索表名..."
                        value={tableKeyword}
                        onChange={(e) => {
                            setTableKeyword(e.target.value);
                            if (!composingRef.current) {
                                setTableKeywordCommitted(e.target.value);
                            }
                        }}
                        onCompositionStart={() => { composingRef.current = true; }}
                        onCompositionEnd={(e) => {
                            composingRef.current = false;
                            const val = (e.target as HTMLInputElement).value;
                            setTableKeyword(val);
                            setTableKeywordCommitted(val);
                        }}
                    />
                </div>
            )}
            <div
                className="metadata-content"
                ref={handleTableScrollRef}
                onScroll={handleTableScroll}
            >
                {loadingTables ? (
                    <div className="metadata-empty">
                        <Loader2 size={24} className="animate-spin" />
                        <span>加载中...</span>
                    </div>
                ) : tables.length === 0 ? (
                    <div className="metadata-empty">
                        <Database size={32} className="metadata-empty-icon" />
                        <span>{selectedDsId && selectedDb ? (tableKeyword ? '未找到匹配的表' : '该数据库下没有表') : '请先选择数据源和数据库'}</span>
                    </div>
                ) : (
                    <div
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualizer.getVirtualItems().map(virtualRow => {
                            const table = tables[virtualRow.index];
                            if (!table) return null;
                            const isExpanded = expandedTables.has(table.name);
                            const cols = columnCache.get(table.name);
                            const isLoadingCols = loadingColumns.has(table.name);

                            return (
                                <div
                                    key={table.name}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <div className="metadata-item">
                                        <button
                                            type="button"
                                            className="metadata-item-header"
                                            onClick={() => toggleTableExpand(table.name)}
                                            aria-expanded={isExpanded}
                                            aria-label={`${isExpanded ? '收起' : '展开'} ${table.name} 字段`}
                                        >
                                            {isExpanded
                                                ? <ChevronDown size={14} className="metadata-chevron" />
                                                : <ChevronRight size={14} className="metadata-chevron" />
                                            }
                                            <Database size={14} className="metadata-icon" />
                                            <span className="metadata-item-name">{table.name}</span>
                                        </button>
                                        {isExpanded && (
                                            <ul className="metadata-columns">
                                                {isLoadingCols ? (
                                                    <li className="metadata-column-loading">
                                                        <Loader2 size={12} className="animate-spin" />
                                                        <span>加载字段...</span>
                                                    </li>
                                                ) : cols ? (
                                                    <>
                                                        {cols.slice(0, 50).map(col => (
                                                            <li key={col.name} className="metadata-column">
                                                                <span className="column-name">{col.name}</span>
                                                                <span className="column-type">{col.type}</span>
                                                            </li>
                                                        ))}
                                                        {cols.length > 50 && (
                                                            <li className="metadata-more">
                                                                还有 {cols.length - 50} 个字段...
                                                            </li>
                                                        )}
                                                    </>
                                                ) : null}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {loadingMoreTables && (
                    <div className="metadata-loading-more">
                        <Loader2 size={14} className="animate-spin" />
                        <span>加载更多...</span>
                    </div>
                )}
            </div>
        </aside>
    );
}
