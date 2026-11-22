import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDataSourceById, getDataSourcePage, type DataSource } from '../../../api/datasource';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { DS_PAGE_SIZE } from '../queryConstants';
import {
    DEFAULT_DATASOURCE_STORAGE_KEY,
    getStoredDefaultDataSourceId,
    getStoredLastDataSourceId,
    LAST_DATASOURCE_STORAGE_KEY,
    shouldPreferDefaultDataSourceOnMount,
} from '../storageUtils';

export interface DataSourceSelectionIntent {
    epoch: number;
    dsId: string;
    connectionDefault?: string;
    ignoreRemembered: boolean;
}

interface UseQueryDataSourcesParams {
    groupId: number | undefined;
    onBeforeDataSourceChange?: (nextDataSourceId: string, isSwitch: boolean) => void;
}

function persistStorageValue(key: string, value: string) {
    try {
        if (value) {
            localStorage.setItem(key, value);
        } else {
            localStorage.removeItem(key);
        }
    } catch {
        /* ignore */
    }
}

export function useQueryDataSources({
    groupId,
    onBeforeDataSourceChange,
}: UseQueryDataSourcesParams) {
    const [selectedDsId, setSelectedDsId] = useState('');
    const [selectedDs, setSelectedDs] = useState<DataSource | null>(null);
    const [preferredFetchedDs, setPreferredFetchedDs] = useState<DataSource | null>(null);
    const [defaultDsId, setDefaultDsId] = useState(getStoredDefaultDataSourceId);
    const [lastDsId, setLastDsId] = useState(getStoredLastDataSourceId);
    const [dsKeyword, setDsKeyword] = useState('');
    const debouncedDsKeyword = useDebouncedValue(dsKeyword, 300);

    const preferDefaultDataSourceOnMountRef = useRef(shouldPreferDefaultDataSourceOnMount());
    const selectionEpochRef = useRef(0);
    const [selectionIntent, setSelectionIntent] = useState<DataSourceSelectionIntent>({
        epoch: 0,
        dsId: '',
        connectionDefault: undefined,
        ignoreRemembered: false,
    });

    const preferredStoredDataSourceId = useMemo(() => (
        preferDefaultDataSourceOnMountRef.current
            ? (defaultDsId || lastDsId)
            : (lastDsId || defaultDsId)
    ), [defaultDsId, lastDsId]);

    const dataSourcesQuery = useInfiniteQuery({
        queryKey: ['query', 'dataSources', groupId, debouncedDsKeyword],
        initialPageParam: 1,
        queryFn: ({ pageParam }) => getDataSourcePage({
            page: pageParam,
            size: DS_PAGE_SIZE,
            keyword: debouncedDsKeyword,
            groupId,
        }),
        getNextPageParam: (lastPage, allPages) => {
            if (lastPage.pages) {
                return lastPage.current < lastPage.pages ? lastPage.current + 1 : undefined;
            }
            return lastPage.records.length === DS_PAGE_SIZE ? allPages.length + 1 : undefined;
        },
    });

    const pagedDataSources = useMemo(() => {
        if (!dataSourcesQuery.data) return [];
        const seen = new Set<number>();
        const list: DataSource[] = [];
        for (const page of dataSourcesQuery.data.pages) {
            for (const item of page.records) {
                if (!seen.has(item.id)) {
                    seen.add(item.id);
                    list.push(item);
                }
            }
        }
        return list;
    }, [dataSourcesQuery.data]);

    const dataSources = useMemo(() => {
        if (!preferredFetchedDs || pagedDataSources.some((item) => item.id === preferredFetchedDs.id)) {
            return pagedDataSources;
        }
        return [preferredFetchedDs, ...pagedDataSources];
    }, [pagedDataSources, preferredFetchedDs]);

    const applySelectedDataSource = useCallback((dataSourceId: string, option?: DataSource | null) => {
        const switchingDataSource = Boolean(selectedDsId) && Boolean(dataSourceId) && dataSourceId !== selectedDsId;
        const resolvedOption = option
            ?? dataSources.find((ds) => String(ds.id) === dataSourceId)
            ?? (selectedDs && String(selectedDs.id) === dataSourceId ? selectedDs : null)
            ?? null;

        selectionEpochRef.current += 1;
        setSelectionIntent({
            epoch: selectionEpochRef.current,
            dsId: dataSourceId,
            connectionDefault: resolvedOption?.databaseName,
            ignoreRemembered: switchingDataSource,
        });

        onBeforeDataSourceChange?.(dataSourceId, switchingDataSource);

        setSelectedDsId(dataSourceId);
        setDsKeyword('');
        setSelectedDs(dataSourceId ? resolvedOption : null);
    }, [dataSources, onBeforeDataSourceChange, selectedDs, selectedDsId]);

    const hasPreferredInList = useMemo(
        () => Boolean(preferredStoredDataSourceId) && dataSources.some((ds) => String(ds.id) === preferredStoredDataSourceId),
        [dataSources, preferredStoredDataSourceId],
    );
    const numericPreferredId = Number(preferredStoredDataSourceId);
    const shouldFetchPreferredById = !selectedDsId
        && !hasPreferredInList
        && Number.isFinite(numericPreferredId)
        && numericPreferredId > 0;

    const preferredDsQuery = useQuery({
        queryKey: ['query', 'preferredDataSource', groupId, numericPreferredId],
        queryFn: () => getDataSourceById(numericPreferredId, groupId),
        enabled: shouldFetchPreferredById,
        retry: false,
    });

    // Apply preferred stored datasource when already present in the loaded list
    useEffect(() => {
        if (selectedDsId || !preferredStoredDataSourceId) return;
        const matched = dataSources.find((ds) => String(ds.id) === preferredStoredDataSourceId);
        if (matched) {
            applySelectedDataSource(preferredStoredDataSourceId, matched);
        }
    }, [applySelectedDataSource, dataSources, preferredStoredDataSourceId, selectedDsId]);

    // Apply preferred datasource fetched by id
    useEffect(() => {
        if (selectedDsId || !shouldFetchPreferredById || !preferredDsQuery.data) return;
        setPreferredFetchedDs(preferredDsQuery.data);
        applySelectedDataSource(String(preferredDsQuery.data.id), preferredDsQuery.data);
    }, [applySelectedDataSource, preferredDsQuery.data, selectedDsId, shouldFetchPreferredById]);

    // Clear stale stored preference when preferred lookup fails
    useEffect(() => {
        if (!shouldFetchPreferredById || !preferredDsQuery.isError) return;
        if (defaultDsId === preferredStoredDataSourceId) {
            setDefaultDsId('');
            persistStorageValue(DEFAULT_DATASOURCE_STORAGE_KEY, '');
        }
        if (lastDsId === preferredStoredDataSourceId) {
            setLastDsId('');
            persistStorageValue(LAST_DATASOURCE_STORAGE_KEY, '');
        }
    }, [defaultDsId, lastDsId, preferredDsQuery.isError, preferredStoredDataSourceId, shouldFetchPreferredById]);

    // Sync matched selectedDs or auto-select sole datasource
    useEffect(() => {
        if (selectedDsId) {
            const matched = dataSources.find((ds) => String(ds.id) === selectedDsId);
            if (matched && (!selectedDs || String(selectedDs.id) !== selectedDsId)) {
                setSelectedDs(matched);
            }
            return;
        }
        if (shouldFetchPreferredById && preferredDsQuery.isFetching) return;
        if (dsKeyword.trim() || dataSources.length === 0) return;

        if (preferredStoredDataSourceId) {
            const preferred = dataSources.find((ds) => String(ds.id) === preferredStoredDataSourceId);
            if (preferred) {
                applySelectedDataSource(String(preferred.id), preferred);
                return;
            }
        }
        if (dataSources.length === 1) {
            applySelectedDataSource(String(dataSources[0].id), dataSources[0]);
        }
    }, [
        applySelectedDataSource,
        dataSources,
        dsKeyword,
        preferredDsQuery.isFetching,
        preferredStoredDataSourceId,
        selectedDs,
        selectedDsId,
        shouldFetchPreferredById,
    ]);

    // Persist last selected data source
    useEffect(() => {
        if (!selectedDsId) return;
        setLastDsId(selectedDsId);
        persistStorageValue(LAST_DATASOURCE_STORAGE_KEY, selectedDsId);
    }, [selectedDsId]);

    useEffect(() => {
        setPreferredFetchedDs(null);
    }, [groupId]);

    const loadingDs = dataSourcesQuery.isFetching && !dataSourcesQuery.isFetchingNextPage;
    const loadingDsMore = dataSourcesQuery.isFetchingNextPage;
    const dsHasMore = Boolean(dataSourcesQuery.hasNextPage);
    const { fetchNextPage: fetchNextDataSourcesPage } = dataSourcesQuery;

    const loadMoreDataSources = useCallback(() => {
        if (loadingDs || loadingDsMore || !dsHasMore) return;
        void fetchNextDataSourcesPage();
    }, [dsHasMore, fetchNextDataSourcesPage, loadingDs, loadingDsMore]);

    const toggleDefaultDataSource = useCallback(() => {
        if (!selectedDsId) return;
        const nextDefault = defaultDsId === selectedDsId ? '' : selectedDsId;
        setDefaultDsId(nextDefault);
        persistStorageValue(DEFAULT_DATASOURCE_STORAGE_KEY, nextDefault);
    }, [defaultDsId, selectedDsId]);

    const getActiveDataSource = useCallback(() => {
        if (selectedDs && String(selectedDs.id) === selectedDsId) return selectedDs;
        return dataSources.find((item) => String(item.id) === selectedDsId) ?? null;
    }, [dataSources, selectedDs, selectedDsId]);

    const updateSelectedDsDefaultDatabase = useCallback((dsId: string, databaseName: string, dsDetail?: DataSource | null) => {
        if (!databaseName) return;
        setSelectedDs((prev) => {
            if (prev && String(prev.id) === dsId) {
                return prev.databaseName === databaseName ? prev : { ...prev, databaseName };
            }
            return dsDetail ?? prev;
        });
    }, []);

    const selectedDsOption = useMemo(() => {
        if (!selectedDs) return null;
        return { label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs };
    }, [selectedDs]);

    const dataSourceOptions = useMemo(() => {
        const base = dataSources.map((ds) => ({ label: ds.name, value: String(ds.id), type: ds.type, raw: ds }));
        if (!selectedDs || base.some((opt) => opt.value === String(selectedDs.id))) {
            return base;
        }
        return [{ label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs }, ...base];
    }, [dataSources, selectedDs]);

    return {
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
        selectionIntent,
        setDsKeyword,
        applySelectedDataSource,
        loadMoreDataSources,
        toggleDefaultDataSource,
        getActiveDataSource,
        updateSelectedDsDefaultDatabase,
    };
}
