import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDataSourceById, type DataSource } from '../../../api/datasource';
import { getDialectMetadata, getMetadataDatabases } from '../../../api/query';
import {
    getStoredLastDatabaseByDataSource,
    LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY,
    mergeDatabaseOptions,
    resolveDatabaseAfterLoad,
} from '../storageUtils';
import type { DataSourceSelectionIntent } from './useQueryDataSources';

interface UseQueryDatabasesAndDialectParams {
    groupId: number | undefined;
    selectedDsId: string;
    selectedDs: DataSource | null;
    dataSources: DataSource[];
    selectionIntent: DataSourceSelectionIntent;
    onBackfillDataSourceDefault: (dsId: string, databaseName: string, dsDetail?: DataSource | null) => void;
}

function persistLastDatabaseByDataSource(nextValue: Record<string, string>) {
    try {
        if (Object.keys(nextValue).length > 0) {
            localStorage.setItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY, JSON.stringify(nextValue));
        } else {
            localStorage.removeItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY);
        }
    } catch {
        /* ignore */
    }
}

export function useQueryDatabasesAndDialect({
    groupId,
    selectedDsId,
    selectedDs,
    dataSources,
    selectionIntent,
    onBackfillDataSourceDefault,
}: UseQueryDatabasesAndDialectParams) {
    const [selectedDb, setSelectedDb] = useState('');
    const [dbKeyword, setDbKeyword] = useState('');
    const [lastDatabaseByDs, setLastDatabaseByDs] = useState<Record<string, string>>(getStoredLastDatabaseByDataSource);

    const lastDatabaseByDsRef = useRef(lastDatabaseByDs);
    lastDatabaseByDsRef.current = lastDatabaseByDs;

    const prevSelectedDsIdRef = useRef(selectedDsId);
    const appliedSelectionEpochRef = useRef(-1);

    const numericDsId = selectedDsId ? Number(selectedDsId) : 0;
    const hasSelectedDs = Boolean(selectedDsId) && Number.isFinite(numericDsId) && numericDsId > 0;

    const prepareForDataSourceChange = useCallback((nextDataSourceId: string, isSwitch: boolean) => {
        if (isSwitch && nextDataSourceId && lastDatabaseByDsRef.current[nextDataSourceId]) {
            const nextMemory = { ...lastDatabaseByDsRef.current };
            delete nextMemory[nextDataSourceId];
            lastDatabaseByDsRef.current = nextMemory;
            setLastDatabaseByDs(nextMemory);
            persistLastDatabaseByDataSource(nextMemory);
        }
        setSelectedDb('');
        setDbKeyword('');
    }, []);

    const dialectQuery = useQuery({
        queryKey: ['query', 'dialect', groupId, numericDsId],
        queryFn: () => getDialectMetadata(numericDsId),
        enabled: hasSelectedDs,
        staleTime: 5 * 60_000,
    });

    const databasesQuery = useQuery({
        queryKey: ['query', 'databases', groupId, numericDsId],
        queryFn: async () => {
            const knownDefault =
                selectionIntent.connectionDefault
                ?? (selectedDs && String(selectedDs.id) === String(numericDsId) ? selectedDs.databaseName : undefined)
                ?? dataSources.find((ds) => ds.id === numericDsId)?.databaseName;

            let effectiveConnectionDefault = knownDefault?.trim() || '';
            let dsDetail: DataSource | null = null;
            if (!effectiveConnectionDefault) {
                try {
                    dsDetail = await getDataSourceById(numericDsId, groupId);
                    effectiveConnectionDefault = dsDetail.databaseName?.trim() || '';
                } catch (fetchError) {
                    console.error('Failed to fetch datasource default database', fetchError);
                }
            }

            const data = await getMetadataDatabases(numericDsId);
            return {
                databases: mergeDatabaseOptions(data),
                fetchedConnectionDefault: effectiveConnectionDefault || undefined,
                dsDetail,
            };
        },
        enabled: hasSelectedDs,
        staleTime: 60_000,
    });

    // Clear selection cleanly when datasource becomes empty
    useEffect(() => {
        if (!selectedDsId) {
            setSelectedDb('');
            setDbKeyword('');
        }
    }, [selectedDsId]);

    // Deterministically resolve selectedDb once per selectionIntent epoch when database list is available (fresh or cached)
    useEffect(() => {
        if (!selectedDsId || !databasesQuery.data) return;
        if (selectionIntent.dsId !== selectedDsId) return;
        if (appliedSelectionEpochRef.current === selectionIntent.epoch) return;

        appliedSelectionEpochRef.current = selectionIntent.epoch;

        const {
            databases: loadedDatabases,
            fetchedConnectionDefault,
            dsDetail,
        } = databasesQuery.data;

        const effectiveConnectionDefault =
            selectionIntent.connectionDefault?.trim()
            || fetchedConnectionDefault
            || (selectedDs && String(selectedDs.id) === selectedDsId ? selectedDs.databaseName?.trim() : undefined)
            || undefined;

        if (fetchedConnectionDefault) {
            onBackfillDataSourceDefault(selectedDsId, fetchedConnectionDefault, dsDetail);
        }

        const rememberedDatabase = selectionIntent.ignoreRemembered
            ? undefined
            : lastDatabaseByDsRef.current[selectedDsId];

        setSelectedDb(resolveDatabaseAfterLoad(loadedDatabases, {
            connectionDefault: effectiveConnectionDefault,
            rememberedDatabase,
            ignoreRemembered: selectionIntent.ignoreRemembered,
        }));
    }, [databasesQuery.data, onBackfillDataSourceDefault, selectedDs, selectedDsId, selectionIntent]);

    // Persist last database per datasource, skipping render frame where selectedDsId just changed
    useEffect(() => {
        const dataSourceChanged = prevSelectedDsIdRef.current !== selectedDsId;
        prevSelectedDsIdRef.current = selectedDsId;
        if (dataSourceChanged) return;
        if (!selectedDsId || !selectedDb) return;
        if (lastDatabaseByDs[selectedDsId] === selectedDb) return;

        const nextValue = { ...lastDatabaseByDs, [selectedDsId]: selectedDb };
        setLastDatabaseByDs(nextValue);
        persistLastDatabaseByDataSource(nextValue);
    }, [lastDatabaseByDs, selectedDb, selectedDsId]);

    const databases = useMemo(
        () => (hasSelectedDs ? (databasesQuery.data?.databases ?? []) : []),
        [databasesQuery.data?.databases, hasSelectedDs],
    );

    const loadingDatabases = hasSelectedDs && databasesQuery.isFetching;

    const filteredDatabases = useMemo(() => {
        if (!dbKeyword) return databases;
        const normalized = dbKeyword.toLowerCase();
        return databases.filter((db) => db.toLowerCase().includes(normalized));
    }, [databases, dbKeyword]);

    const databaseOptions = useMemo(
        () => filteredDatabases.map((db) => ({ label: db, value: db })),
        [filteredDatabases],
    );

    const selectedDbOption = useMemo(() => {
        if (!selectedDb) return null;
        if (!databases.some((db) => db.toLowerCase() === selectedDb.toLowerCase())) {
            return null;
        }
        return { label: selectedDb, value: selectedDb };
    }, [databases, selectedDb]);

    const dialectMetadata = hasSelectedDs ? (dialectQuery.data ?? null) : null;

    return {
        databases,
        selectedDb,
        dbKeyword,
        loadingDatabases,
        filteredDatabases,
        databaseOptions,
        selectedDbOption,
        dialectMetadata,
        setSelectedDb,
        setDbKeyword,
        prepareForDataSourceChange,
    };
}
