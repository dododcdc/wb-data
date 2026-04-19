import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDataSourceById, getDataSourcePage, type DataSource } from '../../api/datasource';
import { DS_PAGE_SIZE } from '../query/queryConstants';

export interface NodeEditorDataSourceOption {
    label: string;
    value: string;
    type?: string;
    raw?: DataSource;
}

interface UseNodeEditorDataSourcesParams {
    open: boolean;
    kind: 'SQL' | 'SHELL';
    groupId: number | null;
    initialDataSourceId?: number;
}

interface UseNodeEditorDataSourcesResult {
    currentDataSourceId?: number;
    selectedDataSource: DataSource | null;
    options: NodeEditorDataSourceOption[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    handleSearchKeywordChange: (keyword: string) => void;
    loadMore: () => void;
    setCurrentDataSourceId: (nextId?: number) => void;
}

export function useNodeEditorDataSources(_params: UseNodeEditorDataSourcesParams): UseNodeEditorDataSourcesResult {
    const { open, kind, groupId, initialDataSourceId } = _params;
    const [currentDataSourceId, setCurrentDataSourceId] = useState<number | undefined>(initialDataSourceId);
    const [selectedDataSource, setSelectedDataSource] = useState<DataSource | null>(null);
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const listRequestIdRef = useRef(0);
    const selectedRequestIdRef = useRef(0);
    const searchTimerRef = useRef<number | null>(null);

    const clearSearchTimer = useCallback(() => {
        if (searchTimerRef.current !== null) {
            window.clearTimeout(searchTimerRef.current);
            searchTimerRef.current = null;
        }
    }, []);

    const loadDataSources = useCallback(async ({
        page: nextPage,
        keyword,
        append,
    }: {
        page: number;
        keyword: string;
        append: boolean;
    }) => {
        if (!groupId || !open || kind !== 'SQL') {
            return;
        }

        const requestId = ++listRequestIdRef.current;
        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }

        try {
            const result = await getDataSourcePage({
                groupId,
                keyword,
                page: nextPage,
                size: DS_PAGE_SIZE,
                status: 'ENABLED',
            });

            if (requestId !== listRequestIdRef.current) {
                return;
            }

            setDataSources((previous) => {
                if (!append) {
                    return result.records;
                }
                const existingIds = new Set(previous.map((item) => item.id));
                return [...previous, ...result.records.filter((item) => !existingIds.has(item.id))];
            });
            setPage(result.current || nextPage);
            setHasMore(result.pages ? result.current < result.pages : result.records.length === DS_PAGE_SIZE);
        } catch (error) {
            console.error('Failed to load node editor data sources', error);
        } finally {
            if (requestId === listRequestIdRef.current) {
                if (append) {
                    setLoadingMore(false);
                } else {
                    setLoading(false);
                }
            }
        }
    }, [groupId, kind, open]);

    useEffect(() => {
        clearSearchTimer();

        if (!open || kind !== 'SQL' || !groupId) {
            setCurrentDataSourceId(initialDataSourceId);
            setSelectedDataSource(null);
            setDataSources([]);
            setSearchKeyword('');
            setPage(1);
            setHasMore(false);
            setLoading(false);
            setLoadingMore(false);
            return;
        }

        setCurrentDataSourceId(initialDataSourceId);
        setSelectedDataSource(null);
        setDataSources([]);
        setSearchKeyword('');
        setPage(1);
        setHasMore(true);
        void loadDataSources({ page: 1, keyword: '', append: false });
    }, [clearSearchTimer, groupId, initialDataSourceId, kind, loadDataSources, open]);

    useEffect(() => {
        if (!open || kind !== 'SQL') {
            return;
        }

        if (!currentDataSourceId) {
            setSelectedDataSource(null);
            return;
        }

        const existing = dataSources.find((item) => item.id === currentDataSourceId) ?? null;
        if (existing) {
            setSelectedDataSource(existing);
            return;
        }

        const requestId = ++selectedRequestIdRef.current;
        getDataSourceById(currentDataSourceId)
            .then((dataSource) => {
                if (requestId !== selectedRequestIdRef.current) {
                    return;
                }
                setSelectedDataSource(dataSource);
                setDataSources((previous) => previous.some((item) => item.id === dataSource.id) ? previous : [dataSource, ...previous]);
            })
            .catch((error) => {
                if (requestId !== selectedRequestIdRef.current) {
                    return;
                }
                console.error('Failed to resolve node editor data source', error);
            });
    }, [currentDataSourceId, dataSources, kind, open]);

    useEffect(() => clearSearchTimer, [clearSearchTimer]);

    const handleSearchKeywordChange = useCallback((keyword: string) => {
        clearSearchTimer();
        setSearchKeyword(keyword);
        searchTimerRef.current = window.setTimeout(() => {
            setPage(1);
            setHasMore(true);
            void loadDataSources({ page: 1, keyword, append: false });
        }, 300);
    }, [clearSearchTimer, loadDataSources]);

    const loadMore = useCallback(() => {
        if (!hasMore || loading || loadingMore) {
            return;
        }
        void loadDataSources({ page: page + 1, keyword: searchKeyword, append: true });
    }, [hasMore, loadDataSources, loading, loadingMore, page, searchKeyword]);

    const options = useMemo(() => {
        const baseOptions = dataSources.map((item) => ({
            label: item.name,
            value: String(item.id),
            type: item.type,
            raw: item,
        }));

        if (!selectedDataSource || baseOptions.some((item) => item.value === String(selectedDataSource.id))) {
            return baseOptions;
        }

        return [
            {
                label: selectedDataSource.name,
                value: String(selectedDataSource.id),
                type: selectedDataSource.type,
                raw: selectedDataSource,
            },
            ...baseOptions,
        ];
    }, [dataSources, selectedDataSource]);

    return {
        currentDataSourceId,
        selectedDataSource,
        options,
        loading,
        loadingMore,
        hasMore,
        handleSearchKeywordChange,
        loadMore,
        setCurrentDataSourceId,
    };
}
