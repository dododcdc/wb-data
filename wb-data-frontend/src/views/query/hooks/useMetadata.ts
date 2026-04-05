/**
 * Query 页面元数据 hook (表结构)
 * 管理数据库表和列的加载、缓存
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { TableSummary, ColumnMetadata, getMetadataTables, getMetadataColumns } from '../../../api/datasource';
import { TABLE_PAGE_SIZE } from '../queryConstants';

// ==================== Hook 返回值 ====================

export interface UseMetadataReturn {
    // State - Tables
    tables: TableSummary[];
    tableKeyword: string;
    tableKeywordCommitted: string;
    tablePage: number;
    tableTotal: number;
    tableHasMore: boolean;
    loadingTables: boolean;
    loadingMoreTables: boolean;
    expandedTables: Set<string>;

    // State - Columns
    columnCache: Map<string, ColumnMetadata[]>;
    loadingColumns: Set<string>;

    // Actions - Tables
    setTables: (tables: TableSummary[]) => void;
    setTableKeyword: (keyword: string) => void;
    setTableKeywordCommitted: (keyword: string) => void;
    setTablePage: (page: number) => void;
    setTableTotal: (total: number) => void;
    setTableHasMore: (hasMore: boolean) => void;
    setLoadingTables: (loading: boolean) => void;
    setLoadingMoreTables: (loading: boolean) => void;
    setExpandedTables: (tables: Set<string>) => void;
    toggleTableExpand: (tableName: string) => void;

    // Actions - Columns
    setColumnCache: (cache: Map<string, ColumnMetadata[]>) => void;
    setLoadingColumns: (columns: Set<string>) => void;

    // Data operations
    loadTables: (dsId: number, dbName: string, keyword?: string, page?: number, append?: boolean) => Promise<void>;
    loadMoreTables: (dsId: number, dbName: string) => void;
    loadColumns: (dsId: number, dbName: string, tableName: string) => Promise<ColumnMetadata[] | null>;

    // Refs for external access
    tablesRef: React.MutableRefObject<TableSummary[]>;
    columnCacheRef: React.MutableRefObject<Map<string, ColumnMetadata[]>>;
    activeDsIdRef: React.MutableRefObject<string>;
    activeDbRef: React.MutableRefObject<string>;
    tableKeywordCommittedRef: React.MutableRefObject<string>;
}

// ==================== Hook ====================

export function useMetadata(): UseMetadataReturn {
    // State - Tables
    const [tables, setTables] = useState<TableSummary[]>([]);
    const [tableKeyword, setTableKeyword] = useState('');
    const [tableKeywordCommitted, setTableKeywordCommitted] = useState('');
    const [tablePage, setTablePage] = useState(1);
    const [tableTotal, setTableTotal] = useState(0);
    const [tableHasMore, setTableHasMore] = useState(true);
    const [loadingTables, setLoadingTables] = useState(false);
    const [loadingMoreTables, setLoadingMoreTables] = useState(false);
    const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

    // State - Columns
    const [columnCache, setColumnCache] = useState<Map<string, ColumnMetadata[]>>(new Map());
    const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());

    // Refs
    const tableLoadingRequestKeysRef = useRef<Set<string>>(new Set());
    const tableListPendingCountRef = useRef(0);
    const tableMorePendingCountRef = useRef(0);
    const tablesRef = useRef(tables);
    const columnCacheRef = useRef(columnCache);
    const activeDsIdRef = useRef('');
    const activeDbRef = useRef('');
    const tableKeywordCommittedRef = useRef('');
    const columnLoadPromisesRef = useRef<Map<string, Promise<ColumnMetadata[] | null>>>(new Map());

    // Sync refs with state
    useEffect(() => {
        tablesRef.current = tables;
    }, [tables]);

    useEffect(() => {
        columnCacheRef.current = columnCache;
    }, [columnCache]);

    // Load tables
    const loadTables = useCallback(async (
        dsId: number,
        dbName: string,
        keyword?: string,
        page: number = 1,
        append: boolean = false
    ) => {
        const normalizedKeyword = (keyword ?? '').trim();
        const requestKey = `${dsId}::${dbName}::${normalizedKeyword}::${page}`;

        if (tableLoadingRequestKeysRef.current.has(requestKey)) {
            return;
        }
        tableLoadingRequestKeysRef.current.add(requestKey);

        if (append) {
            tableMorePendingCountRef.current += 1;
            setLoadingMoreTables(true);
        } else {
            tableListPendingCountRef.current += 1;
            setLoadingTables(true);
        }

        try {
            const result = await getMetadataTables(dsId, dbName, normalizedKeyword || undefined, page, TABLE_PAGE_SIZE);

            const isStale =
                activeDsIdRef.current !== String(dsId) ||
                activeDbRef.current !== dbName ||
                tableKeywordCommittedRef.current.trim() !== normalizedKeyword;

            if (isStale) {
                return;
            }

            if (append) {
                setTables(prev => {
                    const existing = new Set(prev.map(table => table.name));
                    const next = result.data.filter(table => !existing.has(table.name));
                    return [...prev, ...next];
                });
            } else {
                setTables(result.data);
            }

            setTableTotal(result.total);
            const loadedSoFar = append ? (page - 1) * TABLE_PAGE_SIZE + result.data.length : result.data.length;
            setTableHasMore(loadedSoFar < result.total);
            setTablePage(prev => (append ? Math.max(prev, page) : page));
        } catch (error) {
            console.error('Failed to load tables', error);
        } finally {
            tableLoadingRequestKeysRef.current.delete(requestKey);
            if (append) {
                tableMorePendingCountRef.current = Math.max(0, tableMorePendingCountRef.current - 1);
                if (tableMorePendingCountRef.current === 0) {
                    setLoadingMoreTables(false);
                }
            } else {
                tableListPendingCountRef.current = Math.max(0, tableListPendingCountRef.current - 1);
                if (tableListPendingCountRef.current === 0) {
                    setLoadingTables(false);
                }
            }
        }
    }, []);

    // Load more tables
    const loadMoreTables = useCallback((dsId: number, dbName: string) => {
        if (loadingTables || loadingMoreTables || !tableHasMore) return;
        loadTables(dsId, dbName, tableKeywordCommitted || undefined, tablePage + 1, true);
    }, [loadingTables, loadingMoreTables, tableHasMore, tableKeywordCommitted, tablePage, loadTables]);

    // Load columns
    const loadColumns = useCallback(async (dsId: number, dbName: string, tableName: string) => {
        const cachedColumns = columnCacheRef.current.get(tableName);
        if (cachedColumns) {
            return cachedColumns;
        }

        const requestKey = `${dsId}::${dbName}::${tableName}`;
        const existingPromise = columnLoadPromisesRef.current.get(requestKey);
        if (existingPromise) {
            return existingPromise;
        }

        setLoadingColumns(prev => new Set(prev).add(tableName));

        const promise = getMetadataColumns(dsId, dbName, tableName)
            .then(cols => {
                setColumnCache(prev => new Map(prev).set(tableName, cols));
                return cols;
            })
            .catch(() => {
                return null;
            })
            .finally(() => {
                setLoadingColumns(prev => {
                    const next = new Set(prev);
                    next.delete(tableName);
                    return next;
                });
                columnLoadPromisesRef.current.delete(requestKey);
            });

        columnLoadPromisesRef.current.set(requestKey, promise);
        return promise;
    }, []);

    // Toggle table expand
    const toggleTableExpand = useCallback((tableName: string) => {
        setExpandedTables(prev => {
            const next = new Set(prev);
            if (next.has(tableName)) {
                next.delete(tableName);
            } else {
                next.add(tableName);
            }
            return next;
        });
    }, []);

    return {
        // State - Tables
        tables,
        tableKeyword,
        tableKeywordCommitted,
        tablePage,
        tableTotal,
        tableHasMore,
        loadingTables,
        loadingMoreTables,
        expandedTables,

        // State - Columns
        columnCache,
        loadingColumns,

        // Actions - Tables
        setTables,
        setTableKeyword,
        setTableKeywordCommitted,
        setTablePage,
        setTableTotal,
        setTableHasMore,
        setLoadingTables,
        setLoadingMoreTables,
        setExpandedTables,
        toggleTableExpand,

        // Actions - Columns
        setColumnCache,
        setLoadingColumns,

        // Data operations
        loadTables,
        loadMoreTables,
        loadColumns,

        // Refs
        tablesRef,
        columnCacheRef,
        activeDsIdRef,
        activeDbRef,
        tableKeywordCommittedRef,
    };
}
