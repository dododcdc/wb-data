import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { getMetadataColumns, getMetadataTables, type ColumnMetadata, type TableSummary } from '../../../api/query';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { TABLE_PAGE_SIZE } from '../queryConstants';

interface UseQueryTablesAndColumnsParams {
    groupId: number | undefined;
    selectedDsId: string;
    selectedDb: string;
    activeDsIdRef: MutableRefObject<string>;
    activeDbRef: MutableRefObject<string>;
}

export function useQueryTablesAndColumns({
    groupId,
    selectedDsId,
    selectedDb,
    activeDsIdRef,
    activeDbRef,
}: UseQueryTablesAndColumnsParams) {
    const queryClient = useQueryClient();

    const currentScope = selectedDsId && selectedDb ? `${selectedDsId}::${selectedDb}` : '';
    const [tableKeyword, setTableKeyword] = useState('');
    const [tableKeywordCommitted, setTableKeywordCommitted] = useState('');
    const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
    const [columnCache, setColumnCache] = useState<Map<string, ColumnMetadata[]>>(new Map());
    const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());
    const [tableScrollElement, setTableScrollElement] = useState<HTMLDivElement | null>(null);

    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const columnCacheRef = useRef(columnCache);
    columnCacheRef.current = columnCache;
    const columnLoadPromisesRef = useRef<Map<string, Promise<ColumnMetadata[] | null>>>(new Map());

    const debouncedScopeAndKeyword = useDebouncedValue(
        useMemo(() => ({ scope: currentScope, keyword: tableKeywordCommitted.trim() }), [currentScope, tableKeywordCommitted]),
        300,
    );
    const effectiveTableKeyword = debouncedScopeAndKeyword.scope === currentScope
        ? debouncedScopeAndKeyword.keyword
        : '';

    useEffect(() => {
        setTableKeyword('');
        setTableKeywordCommitted('');
        setColumnCache(new Map());
        setExpandedTables(new Set());
    }, [selectedDsId, selectedDb]);

    const numericDsId = selectedDsId ? Number(selectedDsId) : 0;
    const tablesEnabled = Boolean(selectedDsId && selectedDb) && Number.isFinite(numericDsId) && numericDsId > 0;

    const tablesQuery = useInfiniteQuery({
        queryKey: ['query', 'tables', groupId, numericDsId, selectedDb, effectiveTableKeyword],
        initialPageParam: 1,
        enabled: tablesEnabled,
        queryFn: ({ pageParam }) => getMetadataTables(
            numericDsId,
            selectedDb,
            effectiveTableKeyword || undefined,
            pageParam,
            TABLE_PAGE_SIZE,
        ),
        getNextPageParam: (lastPage, allPages) => {
            const loadedCount = allPages.reduce((sum, page) => sum + page.data.length, 0);
            return loadedCount < lastPage.total ? allPages.length + 1 : undefined;
        },
    });

    const tables = useMemo(() => {
        if (!tablesEnabled || !tablesQuery.data) return [];
        const seen = new Set<string>();
        const list: TableSummary[] = [];
        for (const page of tablesQuery.data.pages) {
            for (const table of page.data) {
                if (!seen.has(table.name)) {
                    seen.add(table.name);
                    list.push(table);
                }
            }
        }
        return list;
    }, [tablesEnabled, tablesQuery.data]);

    const tableTotal = tablesEnabled
        ? (tablesQuery.data?.pages[tablesQuery.data.pages.length - 1]?.total ?? 0)
        : 0;
    const loadingTables = tablesEnabled && tablesQuery.isFetching && !tablesQuery.isFetchingNextPage;
    const loadingMoreTables = tablesEnabled && tablesQuery.isFetchingNextPage;
    const tableHasMore = tablesEnabled && Boolean(tablesQuery.hasNextPage);
    const { fetchNextPage: fetchNextTablesPage } = tablesQuery;

    const handleTableScroll = useCallback(() => {
        const el = tableScrollRef.current;
        if (!el || loadingMoreTables || !tableHasMore || !tablesEnabled) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight - scrollTop - clientHeight < 100) {
            void fetchNextTablesPage();
        }
    }, [fetchNextTablesPage, loadingMoreTables, tableHasMore, tablesEnabled]);

    const handleTableScrollRef = useCallback((node: HTMLDivElement | null) => {
        if (tableScrollRef.current === node) return;
        tableScrollRef.current = node;
        setTableScrollElement(node);
    }, []);

    const loadColumns = useCallback(async (dsId: number, dbName: string, tableName: string) => {
        if (activeDsIdRef.current === String(dsId) && activeDbRef.current === dbName) {
            const cached = columnCacheRef.current.get(tableName);
            if (cached) return cached;
        }

        const requestKey = `${dsId}::${dbName}::${tableName}`;
        const existingPromise = columnLoadPromisesRef.current.get(requestKey);
        if (existingPromise) return existingPromise;

        setLoadingColumns((prev) => new Set(prev).add(tableName));

        const requestPromise = (async () => {
            try {
                const cols = await queryClient.fetchQuery({
                    queryKey: ['query', 'columns', groupId, dsId, dbName, tableName],
                    queryFn: () => getMetadataColumns(dsId, dbName, tableName),
                    staleTime: 5 * 60_000,
                });
                if (activeDsIdRef.current === String(dsId) && activeDbRef.current === dbName) {
                    setColumnCache((prev) => new Map(prev).set(tableName, cols));
                }
                return cols;
            } catch (error) {
                console.error('Failed to load columns for', tableName, error);
                return null;
            } finally {
                columnLoadPromisesRef.current.delete(requestKey);
                setLoadingColumns((prev) => {
                    const next = new Set(prev);
                    next.delete(tableName);
                    return next;
                });
            }
        })();

        columnLoadPromisesRef.current.set(requestKey, requestPromise);
        return requestPromise;
    }, [activeDbRef, activeDsIdRef, groupId, queryClient]);

    const toggleTableExpand = useCallback((tableName: string) => {
        setExpandedTables((prev) => {
            const next = new Set(prev);
            if (next.has(tableName)) {
                next.delete(tableName);
            } else {
                next.add(tableName);
                if (!columnCacheRef.current.has(tableName) && selectedDsId && selectedDb) {
                    void loadColumns(Number(selectedDsId), selectedDb, tableName);
                }
            }
            return next;
        });
    }, [loadColumns, selectedDb, selectedDsId]);

    return {
        tables,
        tableKeyword,
        tableKeywordCommitted,
        tableTotal,
        loadingTables,
        loadingMoreTables,
        tableHasMore,
        expandedTables,
        setTableKeyword,
        setTableKeywordCommitted,
        handleTableScroll,
        handleTableScrollRef,
        toggleTableExpand,
        tableScrollElement,
        columnCache,
        loadingColumns,
        loadColumns,
    };
}
