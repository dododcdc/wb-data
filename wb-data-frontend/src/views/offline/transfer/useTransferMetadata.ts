import { useCallback, useEffect, useRef, useState } from 'react';

import { getDataSourceById, getDataSourcePage, type DataSource } from '../../../api/datasource';
import {
    getTransferDatabases,
    getTransferTableMetadata,
    getTransferTables,
    type TransferTableMetadataResponse,
} from '../../../api/transfer';
import type { TransferDataSourceType } from './transferTypes';

export const supportedTransferDataSourceTypes: TransferDataSourceType[] = ['MYSQL', 'POSTGRESQL', 'STARROCKS', 'HIVE'];

export interface TransferAsyncResource<T> {
    data: T;
    loading: boolean;
    error: string | null;
    retry: () => void;
}

export interface TransferPagedResource<T> extends TransferAsyncResource<T[]> {
    loadingMore: boolean;
    hasMore: boolean;
    search: (keyword: string) => void;
    loadMore: () => void;
}

export interface TransferEndpointMetadataState {
    databases: TransferAsyncResource<string[]>;
    tables: TransferPagedResource<string>;
    metadata: TransferAsyncResource<TransferTableMetadataResponse | null>;
}

interface AsyncState<T> {
    data: T;
    loading: boolean;
    error: string | null;
}

const emptyListState = (): AsyncState<string[]> => ({ data: [], loading: false, error: null });
const emptyMetadataState = (): AsyncState<TransferTableMetadataResponse | null> => ({
    data: null,
    loading: false,
    error: null,
});
const TRANSFER_SEARCH_PAGE_SIZE = 50;
const TRANSFER_SEARCH_DEBOUNCE_MS = 300;

interface PagedState<T> extends AsyncState<T[]> {
    loadingMore: boolean;
    hasMore: boolean;
    page: number;
    keyword: string;
}

function emptyPagedState<T>(): PagedState<T> {
    return {
        data: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        error: null,
        page: 1,
        keyword: '',
    };
}

function hasAnotherPage(page: number, size: number, total: number) {
    return page * size < total;
}

function mergeUnique<T>(previous: T[], incoming: T[], key: (item: T) => string | number) {
    const existing = new Set(previous.map(key));
    return [...previous, ...incoming.filter((item) => !existing.has(key(item)))];
}

function useTransferDataSourcesResource(
    groupId: number | null,
    sourceDataSourceId?: number,
    targetDataSourceId?: number,
): TransferPagedResource<DataSource> {
    const [state, setState] = useState<PagedState<DataSource>>(emptyPagedState);
    const [retryKey, setRetryKey] = useState(0);
    const requestIdRef = useRef(0);
    const searchTimerRef = useRef<number | null>(null);
    const selectedIdsRef = useRef(new Set<number>());
    selectedIdsRef.current = new Set([sourceDataSourceId, targetDataSourceId].filter((id): id is number => Boolean(id)));

    const clearSearchTimer = useCallback(() => {
        if (searchTimerRef.current !== null) {
            window.clearTimeout(searchTimerRef.current);
            searchTimerRef.current = null;
        }
    }, []);

    const load = useCallback(async (page: number, keyword: string, append: boolean) => {
        if (!groupId) return;
        const requestId = ++requestIdRef.current;
        setState((current) => ({
            ...current,
            data: append ? current.data : current.data.filter((item) => selectedIdsRef.current.has(item.id)),
            loading: !append,
            loadingMore: append,
            error: null,
            keyword,
        }));
        try {
            const result = await getDataSourcePage({
                groupId,
                page,
                size: TRANSFER_SEARCH_PAGE_SIZE,
                keyword: keyword || undefined,
                status: 'ENABLED',
                type: supportedTransferDataSourceTypes.join(','),
            });
            if (requestId !== requestIdRef.current) return;
            setState((current) => {
                const preserved = append
                    ? current.data
                    : current.data.filter((item) => selectedIdsRef.current.has(item.id));
                return {
                    data: mergeUnique(preserved, result.records ?? [], (item) => item.id),
                    loading: false,
                    loadingMore: false,
                    hasMore: result.pages
                        ? result.current < result.pages
                        : hasAnotherPage(page, TRANSFER_SEARCH_PAGE_SIZE, result.total),
                    error: null,
                    page: result.current || page,
                    keyword,
                };
            });
        } catch {
            if (requestId !== requestIdRef.current) return;
            setState((current) => ({
                ...current,
                loading: false,
                loadingMore: false,
                error: '数据源加载失败',
            }));
        }
    }, [groupId]);

    useEffect(() => {
        clearSearchTimer();
        if (!groupId) {
            requestIdRef.current += 1;
            setState(emptyPagedState());
            return;
        }
        void load(1, '', false);
        return clearSearchTimer;
    }, [clearSearchTimer, groupId, load, retryKey]);

    useEffect(() => {
        if (!groupId) return;
        const selectedIds = [...new Set(
            [sourceDataSourceId, targetDataSourceId].filter((id): id is number => Boolean(id)),
        )];
        if (selectedIds.length === 0) return;

        let active = true;
        void Promise.all(selectedIds.map((id) => getDataSourceById(id, groupId).catch(() => null)))
            .then((selectedDataSources) => {
                if (!active) return;
                const supportedSelections = selectedDataSources.filter((dataSource): dataSource is DataSource => (
                    dataSource !== null
                    && supportedTransferDataSourceTypes.includes(dataSource.type.toUpperCase() as TransferDataSourceType)
                ));
                setState((current) => ({
                    ...current,
                    data: mergeUnique(current.data, supportedSelections, (item) => item.id),
                }));
            });

        return () => { active = false; };
    }, [groupId, retryKey, sourceDataSourceId, targetDataSourceId]);

    const search = useCallback((keyword: string) => {
        clearSearchTimer();
        searchTimerRef.current = window.setTimeout(() => {
            void load(1, keyword.trim(), false);
        }, TRANSFER_SEARCH_DEBOUNCE_MS);
    }, [clearSearchTimer, load]);

    const loadMore = useCallback(() => {
        if (!state.hasMore || state.loading || state.loadingMore) return;
        void load(state.page + 1, state.keyword, true);
    }, [load, state.hasMore, state.keyword, state.loading, state.loadingMore, state.page]);

    return {
        data: state.data,
        loading: state.loading,
        loadingMore: state.loadingMore,
        hasMore: state.hasMore,
        error: state.error,
        retry: () => setRetryKey((current) => current + 1),
        search,
        loadMore,
    };
}

function useTransferDatabasesResource(
    groupId: number | null,
    dataSourceId?: number,
): TransferAsyncResource<string[]> {
    const [state, setState] = useState<AsyncState<string[]>>(emptyListState);
    const [retryKey, setRetryKey] = useState(0);
    const retry = useCallback(() => setRetryKey((current) => current + 1), []);

    useEffect(() => {
        if (!groupId || !dataSourceId) {
            setState(emptyListState());
            return;
        }
        let active = true;
        setState({ data: [], loading: true, error: null });
        void getTransferDatabases(groupId, dataSourceId)
            .then((databases) => {
                if (active) setState({ data: databases ?? [], loading: false, error: null });
            })
            .catch(() => {
                if (active) setState({ data: [], loading: false, error: '数据库加载失败' });
            });
        return () => { active = false; };
    }, [dataSourceId, groupId, retryKey]);

    return { ...state, retry };
}

function useTransferTablesResource(
    groupId: number | null,
    dataSourceId?: number,
    database?: string,
): TransferPagedResource<string> {
    const [state, setState] = useState<PagedState<string>>(emptyPagedState);
    const [retryKey, setRetryKey] = useState(0);
    const requestIdRef = useRef(0);
    const searchTimerRef = useRef<number | null>(null);

    const clearSearchTimer = useCallback(() => {
        if (searchTimerRef.current !== null) {
            window.clearTimeout(searchTimerRef.current);
            searchTimerRef.current = null;
        }
    }, []);

    const load = useCallback(async (page: number, keyword: string, append: boolean) => {
        if (!groupId || !dataSourceId || !database) return;
        const requestId = ++requestIdRef.current;
        setState((current) => ({
            ...current,
            data: append ? current.data : [],
            loading: !append,
            loadingMore: append,
            error: null,
            keyword,
        }));
        try {
            const result = await getTransferTables(groupId, dataSourceId, {
                databaseName: database,
                ...(keyword ? { keyword } : {}),
                page,
                size: TRANSFER_SEARCH_PAGE_SIZE,
            });
            if (requestId !== requestIdRef.current) return;
            const tables = (result.data ?? []).map((table) => table.name);
            setState((current) => ({
                data: append ? mergeUnique(current.data, tables, (table) => table) : tables,
                loading: false,
                loadingMore: false,
                hasMore: hasAnotherPage(result.page || page, result.size || TRANSFER_SEARCH_PAGE_SIZE, result.total),
                error: null,
                page: result.page || page,
                keyword,
            }));
        } catch {
            if (requestId !== requestIdRef.current) return;
            setState((current) => ({
                ...current,
                loading: false,
                loadingMore: false,
                error: '表加载失败',
            }));
        }
    }, [dataSourceId, database, groupId]);

    useEffect(() => {
        clearSearchTimer();
        if (!groupId || !dataSourceId || !database) {
            requestIdRef.current += 1;
            setState(emptyPagedState());
            return;
        }
        void load(1, '', false);
        return clearSearchTimer;
    }, [clearSearchTimer, dataSourceId, database, groupId, load, retryKey]);

    const search = useCallback((keyword: string) => {
        clearSearchTimer();
        searchTimerRef.current = window.setTimeout(() => {
            void load(1, keyword.trim(), false);
        }, TRANSFER_SEARCH_DEBOUNCE_MS);
    }, [clearSearchTimer, load]);

    const loadMore = useCallback(() => {
        if (!state.hasMore || state.loading || state.loadingMore) return;
        void load(state.page + 1, state.keyword, true);
    }, [load, state.hasMore, state.keyword, state.loading, state.loadingMore, state.page]);

    return {
        data: state.data,
        loading: state.loading,
        loadingMore: state.loadingMore,
        hasMore: state.hasMore,
        error: state.error,
        retry: () => setRetryKey((current) => current + 1),
        search,
        loadMore,
    };
}

function useTransferTableMetadataResource(
    groupId: number | null,
    dataSourceId?: number,
    database?: string,
    table?: string,
): TransferAsyncResource<TransferTableMetadataResponse | null> {
    const [state, setState] = useState<AsyncState<TransferTableMetadataResponse | null>>(emptyMetadataState);
    const [retryKey, setRetryKey] = useState(0);
    const retry = useCallback(() => setRetryKey((current) => current + 1), []);

    useEffect(() => {
        if (!groupId || !dataSourceId || !database || !table) {
            setState(emptyMetadataState());
            return;
        }
        let active = true;
        setState({ data: null, loading: true, error: null });
        void getTransferTableMetadata(groupId, dataSourceId, database, table)
            .then((metadata) => {
                if (active) setState({ data: metadata, loading: false, error: null });
            })
            .catch(() => {
                if (active) setState({ data: null, loading: false, error: '字段元数据加载失败' });
            });
        return () => { active = false; };
    }, [dataSourceId, database, groupId, retryKey, table]);

    return { ...state, retry };
}

function useTransferEndpointMetadata(
    groupId: number | null,
    dataSourceId?: number,
    database?: string,
    table?: string,
): TransferEndpointMetadataState {
    return {
        databases: useTransferDatabasesResource(groupId, dataSourceId),
        tables: useTransferTablesResource(groupId, dataSourceId, database),
        metadata: useTransferTableMetadataResource(groupId, dataSourceId, database, table),
    };
}

export function useTransferMetadata(
    groupId: number | null,
    sourceDataSourceId?: number,
    sourceDatabase?: string,
    sourceTable?: string,
    targetDataSourceId?: number,
    targetDatabase?: string,
    targetTable?: string,
) {
    const dataSourceSearch = useTransferDataSourcesResource(
        groupId,
        sourceDataSourceId,
        targetDataSourceId,
    );

    const source = useTransferEndpointMetadata(
        groupId,
        sourceDataSourceId,
        sourceDatabase,
        sourceTable,
    );
    const target = useTransferEndpointMetadata(
        groupId,
        targetDataSourceId,
        targetDatabase,
        targetTable,
    );

    return { dataSources: dataSourceSearch.data, dataSourceSearch, source, target };
}
