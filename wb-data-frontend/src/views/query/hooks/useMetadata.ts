/**
 * 元数据管理 hook
 * 管理数据源、数据库、表、字段的加载与状态。
 *
 * 从 Query.tsx 中提取，将约 25 个 useState + 13 个 useRef + 14 个函数 + 12 个 useEffect
 * 整合为单一 hook，Query 组件只需消费返回值。
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    getMetadataDatabases,
    getMetadataTables,
    getMetadataColumns,
    getDialectMetadata,
    TableSummary,
    ColumnMetadata,
    DialectMetadata,
} from '../../../api/query';
import { getDataSourcePage, getDataSourceById, DataSource } from '../../../api/datasource';
import {
    DS_PAGE_SIZE,
    TABLE_PAGE_SIZE,
} from '../queryConstants';
import {
    DEFAULT_DATASOURCE_STORAGE_KEY,
    LAST_DATASOURCE_STORAGE_KEY,
    LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY,
    getStoredDefaultDataSourceId,
    getStoredLastDataSourceId,
    getStoredLastDatabaseByDataSource,
    shouldPreferDefaultDataSourceOnMount,
    mergeDatabaseOptions,
    resolveDatabaseAfterLoad,
} from '../storageUtils';

// ==================== Hook ====================

export function useMetadata(groupId: number | undefined) {
    // ---- Data Source state ----
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [selectedDsId, setSelectedDsId] = useState<string>('');
    const [selectedDs, setSelectedDs] = useState<DataSource | null>(null);
    const [defaultDsId, setDefaultDsId] = useState(getStoredDefaultDataSourceId);
    const [lastDsId, setLastDsId] = useState(getStoredLastDataSourceId);
    const [lastDatabaseByDs, setLastDatabaseByDs] = useState<Record<string, string>>(getStoredLastDatabaseByDataSource);
    const [dsKeyword, setDsKeyword] = useState('');
    const [loadingDs, setLoadingDs] = useState(false);
    const [loadingDsMore, setLoadingDsMore] = useState(false);
    const [dsPage, setDsPage] = useState(1);
    const [dsHasMore, setDsHasMore] = useState(true);

    // ---- Database state ----
    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDb, setSelectedDb] = useState<string>('');
    const [dbKeyword, setDbKeyword] = useState('');
    const [loadingDatabases, setLoadingDatabases] = useState(false);

    // ---- Table state ----
    const [tables, setTables] = useState<TableSummary[]>([]);
    const [tableKeyword, setTableKeyword] = useState('');
    const [tableKeywordCommitted, setTableKeywordCommitted] = useState('');
    const [tablePage, setTablePage] = useState(1);
    const [tableHasMore, setTableHasMore] = useState(true);
    const [tableTotal, setTableTotal] = useState(0);
    const [loadingTables, setLoadingTables] = useState(false);
    const [loadingMoreTables, setLoadingMoreTables] = useState(false);
    const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

    // ---- Column state ----
    const [columnCache, setColumnCache] = useState<Map<string, ColumnMetadata[]>>(new Map());
    const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());

    // ---- Dialect state ----
    const [dialectMetadata, setDialectMetadata] = useState<DialectMetadata | null>(null);

    // ---- Table scroll for virtualization ----
    const [tableScrollElement, setTableScrollElement] = useState<HTMLDivElement | null>(null);
    const tableScrollRef = useRef<HTMLDivElement | null>(null);

    // ---- Internal refs ----
    const dsRequestIdRef = useRef(0);
    const preferredDsRequestIdRef = useRef(0);
    const databasesRequestIdRef = useRef(0);
    const dialectRequestIdRef = useRef(0);
    const tableLoadingRequestKeysRef = useRef<Set<string>>(new Set());
    const tableListPendingCountRef = useRef(0);
    const tableMorePendingCountRef = useRef(0);
    const activeDsIdRef = useRef('');
    const activeDbRef = useRef('');
    const tableKeywordCommittedRef = useRef('');
    const loadingColumnsRef = useRef(loadingColumns);
    const columnLoadPromisesRef = useRef<Map<string, Promise<ColumnMetadata[] | null>>>(new Map());
    const preferDefaultDataSourceOnMountRef = useRef(shouldPreferDefaultDataSourceOnMount());
    const prevSelectedDsIdRef = useRef(selectedDsId);
    /** Keep memory map out of the databases-load effect deps (ref only). */
    const lastDatabaseByDsRef = useRef(lastDatabaseByDs);
    /** connectionDefault captured at apply/switch time so the load effect cannot lose it. */
    const pendingConnectionDefaultRef = useRef<string | undefined>(undefined);
    /** When true, loadDatabases must ignore per-DS remembered database. */
    const ignoreRememberedDbRef = useRef(false);
    /** Request id that owns the current pending connection-default / ignore-remembered flags. */
    const pendingDbLoadRequestIdRef = useRef(0);

    // ==================== Derived values ====================

    const preferredStoredDataSourceId = useMemo(() => {
        return preferDefaultDataSourceOnMountRef.current
            ? (defaultDsId || lastDsId)
            : (lastDsId || defaultDsId);
    }, [defaultDsId, lastDsId]);

    const selectedDsOption = useMemo(() => {
        if (!selectedDs) return null;
        return { label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs };
    }, [selectedDs]);

    const dataSourceOptions = useMemo(() => {
        const base = dataSources.map(ds => ({ label: ds.name, value: String(ds.id), type: ds.type, raw: ds }));
        if (!selectedDs || base.some(opt => opt.value === String(selectedDs.id))) {
            return base;
        }
        return [{ label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs }, ...base];
    }, [dataSources, selectedDs]);

    const filteredDatabases = useMemo(() => {
        if (!dbKeyword) return databases;
        const normalized = dbKeyword.toLowerCase();
        return databases.filter(db => db.toLowerCase().includes(normalized));
    }, [databases, dbKeyword]);

    const databaseOptions = useMemo(() => {
        return filteredDatabases.map(db => ({ label: db, value: db }));
    }, [filteredDatabases]);

    const selectedDbOption = useMemo(() => {
        if (!selectedDb) return null;
        // Never surface a stale label that is not in the current datasource's list.
        if (!databases.some(db => db.toLowerCase() === selectedDb.toLowerCase())) {
            return null;
        }
        return { label: selectedDb, value: selectedDb };
    }, [databases, selectedDb]);

    // ==================== Persistence helpers ====================

    const persistDefaultDataSourceId = useCallback((dataSourceId: string) => {
        try {
            if (dataSourceId) {
                localStorage.setItem(DEFAULT_DATASOURCE_STORAGE_KEY, dataSourceId);
            } else {
                localStorage.removeItem(DEFAULT_DATASOURCE_STORAGE_KEY);
            }
        } catch { /* ignore */ }
    }, []);

    const persistLastDataSourceId = useCallback((dataSourceId: string) => {
        try {
            if (dataSourceId) {
                localStorage.setItem(LAST_DATASOURCE_STORAGE_KEY, dataSourceId);
            } else {
                localStorage.removeItem(LAST_DATASOURCE_STORAGE_KEY);
            }
        } catch { /* ignore */ }
    }, []);

    const persistLastDatabaseByDataSource = useCallback((nextValue: Record<string, string>) => {
        try {
            if (Object.keys(nextValue).length > 0) {
                localStorage.setItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY, JSON.stringify(nextValue));
            } else {
                localStorage.removeItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY);
            }
        } catch { /* ignore */ }
    }, []);

    // ==================== Core helpers ====================

    const getActiveDataSource = useCallback(() => {
        if (selectedDs && String(selectedDs.id) === selectedDsId) return selectedDs;
        return dataSources.find(item => String(item.id) === selectedDsId) ?? null;
    }, [dataSources, selectedDs, selectedDsId]);

    const applySelectedDataSource = useCallback((dataSourceId: string, option?: DataSource | null) => {
        // True switch between two datasources (not the initial empty → first selection).
        const switchingDataSource = Boolean(selectedDsId) && Boolean(dataSourceId) && dataSourceId !== selectedDsId;

        const resolvedOption =
            option
            ?? dataSources.find(ds => String(ds.id) === dataSourceId)
            ?? (selectedDs && String(selectedDs.id) === dataSourceId ? selectedDs : null)
            ?? null;

        // Capture configured databaseName at switch/apply time so the async load
        // effect cannot observe a null getActiveDataSource and lose connectionDefault.
        pendingConnectionDefaultRef.current = resolvedOption?.databaseName;
        ignoreRememberedDbRef.current = switchingDataSource;

        // Always drop per-DS memory for the target on switch so a contaminated
        // sticky name (e.g. previous shared-server schema) cannot win on later
        // non-switch loads until the user explicitly picks a DB on that DS.
        if (switchingDataSource && dataSourceId) {
            if (lastDatabaseByDsRef.current[dataSourceId]) {
                const nextMemory = { ...lastDatabaseByDsRef.current };
                delete nextMemory[dataSourceId];
                lastDatabaseByDsRef.current = nextMemory;
                setLastDatabaseByDs(nextMemory);
                persistLastDatabaseByDataSource(nextMemory);
            }
        }

        setSelectedDsId(dataSourceId);
        setDsKeyword('');
        // Clear immediately so the previous datasource's database cannot linger
        // in the combobox or get persisted under the new datasource id.
        setSelectedDb('');
        setDatabases([]);
        setDbKeyword('');

        if (!dataSourceId) {
            pendingConnectionDefaultRef.current = undefined;
            ignoreRememberedDbRef.current = false;
            setSelectedDs(null);
            return;
        }

        setSelectedDs(resolvedOption);
    }, [dataSources, persistLastDatabaseByDataSource, selectedDs, selectedDsId]);

    // ==================== Data loading functions ====================

    const loadDataSources = useCallback(async ({ page, keyword, append }: { page: number; keyword: string; append: boolean }) => {
        const requestId = ++dsRequestIdRef.current;
        if (append) {
            setLoadingDsMore(true);
        } else {
            setLoadingDs(true);
        }
        try {
            const data = await getDataSourcePage({ page, size: DS_PAGE_SIZE, keyword, groupId });
            if (requestId !== dsRequestIdRef.current) return;
            setDataSources((prev) => {
                if (!append) return data.records;
                const existingIds = new Set(prev.map(item => item.id));
                return [...prev, ...data.records.filter(item => !existingIds.has(item.id))];
            });
            const hasMore = data.pages ? data.current < data.pages : data.records.length === DS_PAGE_SIZE;
            setDsPage(data.current || page);
            setDsHasMore(hasMore);
        } catch (error) {
            console.error('Failed to load data sources', error);
        } finally {
            if (requestId === dsRequestIdRef.current) {
                if (append) {
                    setLoadingDsMore(false);
                } else {
                    setLoadingDs(false);
                }
            }
        }
    }, [groupId]);

    const loadMoreDataSources = () => {
        if (loadingDs || loadingDsMore || !dsHasMore) return;
        loadDataSources({ page: dsPage + 1, keyword: dsKeyword, append: true });
    };

    const loadDialect = async (id: number) => {
        const requestId = ++dialectRequestIdRef.current;
        try {
            const data = await getDialectMetadata(id);
            if (requestId !== dialectRequestIdRef.current) return;
            if (activeDsIdRef.current !== String(id)) return;
            setDialectMetadata(data);
        } catch (error) {
            console.error('Failed to load dialect metadata', error);
        }
    };

    const loadDatabases = async (
        id: number,
        preferredDatabase?: string,
        connectionDefault?: string,
        ignoreRemembered: boolean = false,
    ) => {
        const requestId = ++databasesRequestIdRef.current;
        pendingDbLoadRequestIdRef.current = requestId;
        setLoadingDatabases(true);
        try {
            // Never pick with an empty connectionDefault when the DS has one —
            // page/list payloads or Combobox-stripped options can omit databaseName.
            let effectiveConnectionDefault = connectionDefault?.trim() || '';
            if (!effectiveConnectionDefault) {
                try {
                    const dsDetail = await getDataSourceById(id, groupId);
                    if (requestId !== databasesRequestIdRef.current) return;
                    if (activeDsIdRef.current !== String(id)) return;
                    effectiveConnectionDefault = dsDetail.databaseName?.trim() || '';
                    if (effectiveConnectionDefault) {
                        pendingConnectionDefaultRef.current = effectiveConnectionDefault;
                        setSelectedDs((prev) => {
                            if (prev && String(prev.id) === String(id)) {
                                return { ...prev, databaseName: effectiveConnectionDefault };
                            }
                            return prev ?? dsDetail;
                        });
                    }
                } catch (fetchError) {
                    console.error('Failed to fetch datasource default database', fetchError);
                }
            }

            const data = await getMetadataDatabases(id);
            if (requestId !== databasesRequestIdRef.current) return;
            if (activeDsIdRef.current !== String(id)) return;
            const loadedDatabases = mergeDatabaseOptions(data);
            setDatabases(loadedDatabases);
            setSelectedDb(resolveDatabaseAfterLoad(loadedDatabases, {
                connectionDefault: effectiveConnectionDefault || undefined,
                // On switch, never pass remembered — resolve policy is connectionDefault || list[0].
                rememberedDatabase: ignoreRemembered ? undefined : preferredDatabase,
                ignoreRemembered,
            }));
            // Clear switch/pending markers only after this matching request is applied.
            if (pendingDbLoadRequestIdRef.current === requestId) {
                pendingConnectionDefaultRef.current = undefined;
                ignoreRememberedDbRef.current = false;
            }
        } catch (error) {
            console.error('Failed to load databases', error);
        } finally {
            if (requestId === databasesRequestIdRef.current) {
                setLoadingDatabases(false);
            }
        }
    };

    const loadTables = async (dsId: number, dbName: string, keyword?: string, page: number = 1, append: boolean = false) => {
        const normalizedKeyword = (keyword ?? '').trim();
        const requestKey = `${dsId}::${dbName}::${normalizedKeyword}::${page}`;
        if (tableLoadingRequestKeysRef.current.has(requestKey)) return;
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
            if (isStale) return;

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
    };

    const loadColumns = async (dsId: number, dbName: string, tableName: string) => {
        const cachedColumns = columnCache.get(tableName);
        if (cachedColumns) return cachedColumns;

        const requestKey = `${dsId}::${dbName}::${tableName}`;
        const existingPromise = columnLoadPromisesRef.current.get(requestKey);
        if (existingPromise) return existingPromise;

        setLoadingColumns(prev => new Set(prev).add(tableName));

        const requestPromise = (async () => {
            try {
                const cols = await getMetadataColumns(dsId, dbName, tableName);
                if (activeDsIdRef.current === String(dsId) && activeDbRef.current === dbName) {
                    setColumnCache(prev => new Map(prev).set(tableName, cols));
                }
                return cols;
            } catch (error) {
                console.error('Failed to load columns for', tableName, error);
                return null;
            } finally {
                columnLoadPromisesRef.current.delete(requestKey);
                setLoadingColumns(prev => {
                    const next = new Set(prev);
                    next.delete(tableName);
                    return next;
                });
            }
        })();

        columnLoadPromisesRef.current.set(requestKey, requestPromise);
        return requestPromise;
    };

    // ==================== UI interaction handlers ====================

    const handleTableScroll = useCallback(() => {
        const el = tableScrollRef.current;
        if (!el || loadingMoreTables || !tableHasMore || !selectedDsId || !selectedDb) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight - scrollTop - clientHeight < 100) {
            loadTables(Number(selectedDsId), selectedDb, tableKeywordCommitted || undefined, tablePage + 1, true);
        }
    }, [loadingMoreTables, tableHasMore, selectedDsId, selectedDb, tableKeywordCommitted, tablePage]);

    const handleTableScrollRef = useCallback((node: HTMLDivElement | null) => {
        if (tableScrollRef.current === node) return;
        tableScrollRef.current = node;
        setTableScrollElement(node);
    }, []);

    const toggleTableExpand = (tableName: string) => {
        setExpandedTables(prev => {
            const next = new Set(prev);
            if (next.has(tableName)) {
                next.delete(tableName);
            } else {
                next.add(tableName);
                if (!columnCache.has(tableName) && selectedDsId && selectedDb) {
                    loadColumns(Number(selectedDsId), selectedDb, tableName);
                }
            }
            return next;
        });
    };

    const toggleDefaultDataSource = useCallback(() => {
        if (!selectedDsId) return;

        const nextDefaultDataSourceId = defaultDsId === selectedDsId ? '' : selectedDsId;
        setDefaultDsId(nextDefaultDataSourceId);
        persistDefaultDataSourceId(nextDefaultDataSourceId);
    }, [defaultDsId, persistDefaultDataSourceId, selectedDsId]);

    // ==================== Sync effects ====================

    useEffect(() => { activeDsIdRef.current = selectedDsId; }, [selectedDsId]);
    useEffect(() => { activeDbRef.current = selectedDb; }, [selectedDb]);
    useEffect(() => { loadingColumnsRef.current = loadingColumns; }, [loadingColumns]);
    useEffect(() => { tableKeywordCommittedRef.current = tableKeywordCommitted; }, [selectedDb, selectedDsId, tableKeywordCommitted]);
    useEffect(() => { lastDatabaseByDsRef.current = lastDatabaseByDs; }, [lastDatabaseByDs]);

    // Persist last selected data source
    useEffect(() => {
        if (!selectedDsId) return;
        setLastDsId(selectedDsId);
        persistLastDataSourceId(selectedDsId);
    }, [persistLastDataSourceId, selectedDsId]);

    // Persist last database per data source
    useEffect(() => {
        const dataSourceChanged = prevSelectedDsIdRef.current !== selectedDsId;
        prevSelectedDsIdRef.current = selectedDsId;
        // When the datasource just changed, selectedDb may still be the previous
        // datasource's value for one render — do not save that under the new id.
        if (dataSourceChanged) return;
        if (!selectedDsId || !selectedDb) return;
        if (lastDatabaseByDs[selectedDsId] === selectedDb) return;

        const nextValue = { ...lastDatabaseByDs, [selectedDsId]: selectedDb };
        setLastDatabaseByDs(nextValue);
        persistLastDatabaseByDataSource(nextValue);
    }, [lastDatabaseByDs, persistLastDatabaseByDataSource, selectedDb, selectedDsId]);

    // ==================== Data loading triggers ====================

    // Debounced data source search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDataSources([]);
            setDsHasMore(true);
            setDsPage(1);
            setLoadingDsMore(false);
            loadDataSources({ page: 1, keyword: dsKeyword, append: false });
        }, 300);
        return () => clearTimeout(timer);
    }, [dsKeyword, groupId, loadDataSources]);

    // Resolve preferred data source on mount
    useEffect(() => {
        if (selectedDsId) return;

        const preferredDataSourceId = preferredStoredDataSourceId;
        if (!preferredDataSourceId) return;

        const existingDataSource = dataSources.find(ds => String(ds.id) === preferredDataSourceId);
        if (existingDataSource) {
            applySelectedDataSource(preferredDataSourceId, existingDataSource);
            return;
        }

        const numericPreferredId = Number(preferredDataSourceId);
        if (!Number.isFinite(numericPreferredId) || numericPreferredId <= 0) return;

        const requestId = ++preferredDsRequestIdRef.current;
        getDataSourceById(numericPreferredId, groupId)
            .then((dataSource) => {
                if (preferredDsRequestIdRef.current !== requestId) return;
                setDataSources(prev => prev.some(item => item.id === dataSource.id) ? prev : [dataSource, ...prev]);
                applySelectedDataSource(preferredDataSourceId, dataSource);
            })
            .catch(() => {
                if (preferredDsRequestIdRef.current !== requestId) return;
                if (defaultDsId === preferredDataSourceId) {
                    setDefaultDsId('');
                    persistDefaultDataSourceId('');
                }
                if (lastDsId === preferredDataSourceId) {
                    setLastDsId('');
                    persistLastDataSourceId('');
                }
            });
    }, [
        applySelectedDataSource,
        dataSources,
        persistDefaultDataSourceId,
        persistLastDataSourceId,
        preferredStoredDataSourceId,
        selectedDsId,
        defaultDsId,
        groupId,
        lastDsId,
    ]);

    // Auto-select data source from loaded list
    useEffect(() => {
        if (selectedDsId) {
            const matchedDataSource = dataSources.find(ds => String(ds.id) === selectedDsId);
            if (matchedDataSource && (!selectedDs || String(selectedDs.id) !== selectedDsId)) {
                setSelectedDs(matchedDataSource);
            }
            return;
        }

        if (dsKeyword.trim() || dataSources.length === 0) return;

        const preferredDataSourceId = preferredStoredDataSourceId;
        const preferredDataSource = preferredDataSourceId
            ? dataSources.find(ds => String(ds.id) === preferredDataSourceId)
            : null;

        if (preferredDataSource) {
            applySelectedDataSource(String(preferredDataSource.id), preferredDataSource);
            return;
        }

        if (dataSources.length === 1) {
            applySelectedDataSource(String(dataSources[0].id), dataSources[0]);
        }
    }, [applySelectedDataSource, dataSources, dsKeyword, preferredStoredDataSourceId, selectedDs, selectedDsId]);

    // Load databases + dialect only when the selected datasource id changes.
    // Do NOT re-fetch when lastDatabaseByDs / getActiveDataSource identity changes —
    // that re-entry race was clearing switch markers and letting a sticky remembered
    // name win with connectionDefault undefined.
    useEffect(() => {
        if (selectedDsId) {
            const ignoreRemembered = ignoreRememberedDbRef.current;
            const connectionDefault =
                pendingConnectionDefaultRef.current
                ?? (selectedDs && String(selectedDs.id) === selectedDsId ? selectedDs.databaseName : undefined)
                ?? dataSources.find(ds => String(ds.id) === selectedDsId)?.databaseName;
            // On switch: ignore memory entirely. Otherwise use per-DS memory.
            const preferredDatabase = ignoreRemembered
                ? undefined
                : lastDatabaseByDsRef.current[selectedDsId];

            setDbKeyword('');
            setSelectedDb('');
            setDatabases([]);
            setTables([]);
            setColumnCache(new Map());
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTableTotal(0);
            loadDatabases(Number(selectedDsId), preferredDatabase, connectionDefault, ignoreRemembered);
            loadDialect(Number(selectedDsId));
        } else {
            pendingConnectionDefaultRef.current = undefined;
            ignoreRememberedDbRef.current = false;
            setDatabases([]);
            setSelectedDb('');
            setDbKeyword('');
            setTables([]);
            setColumnCache(new Map());
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTableTotal(0);
            setDialectMetadata(null);
            setSelectedDs(null);
        }
        // Intentionally only selectedDsId: memory map + active DS are read via refs /
        // values captured at apply time so switch markers stay valid for the request.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDsId]);

    // Reset metadata when database changes
    useEffect(() => {
        if (!selectedDsId || !selectedDb) return;
        setTableKeyword('');
        setTableKeywordCommitted('');
        setColumnCache(new Map());
    }, [selectedDsId, selectedDb]);

    // Debounced table search
    useEffect(() => {
        if (!selectedDsId || !selectedDb) return;
        const timer = setTimeout(() => {
            setTablePage(1);
            setTableHasMore(true);
            setTableTotal(0);
            loadTables(Number(selectedDsId), selectedDb, tableKeywordCommitted, 1, false);
        }, 300);
        return () => clearTimeout(timer);
    }, [selectedDb, selectedDsId, tableKeywordCommitted]);

    // Reset expanded tables when datasource/database changes
    useEffect(() => {
        setExpandedTables(new Set());
    }, [selectedDsId, selectedDb]);

    // ==================== Return ====================

    return {
        // Data source
        dataSources,
        selectedDsId,
        selectedDs,
        defaultDsId,
        dsKeyword,
        loadingDs,
        loadingDsMore,
        dsHasMore,
        selectedDsOption,
        dataSourceOptions,
        setDsKeyword,
        setSelectedDb,
        applySelectedDataSource,
        loadMoreDataSources,
        toggleDefaultDataSource,
        getActiveDataSource,

        // Database
        databases,
        selectedDb,
        dbKeyword,
        loadingDatabases,
        filteredDatabases,
        databaseOptions,
        selectedDbOption,
        setDbKeyword,

        // Table
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

        // Column
        columnCache,
        loadingColumns,
        loadColumns,

        // Dialect
        dialectMetadata,

        // Refs exposed for external use (e.g., useSqlCompletion)
        activeDsIdRef,
        activeDbRef,
    };
}
