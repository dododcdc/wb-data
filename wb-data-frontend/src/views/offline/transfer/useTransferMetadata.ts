import { useCallback, useEffect, useState } from 'react';

import { getDataSourcePage, type DataSource } from '../../../api/datasource';
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

export interface TransferEndpointMetadataState {
    databases: TransferAsyncResource<string[]>;
    tables: TransferAsyncResource<string[]>;
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
): TransferAsyncResource<string[]> {
    const [state, setState] = useState<AsyncState<string[]>>(emptyListState);
    const [retryKey, setRetryKey] = useState(0);
    const retry = useCallback(() => setRetryKey((current) => current + 1), []);

    useEffect(() => {
        if (!groupId || !dataSourceId || !database) {
            setState(emptyListState());
            return;
        }
        let active = true;
        setState({ data: [], loading: true, error: null });
        void getTransferTables(groupId, dataSourceId, { databaseName: database, page: 1, size: 200 })
            .then((result) => {
                if (active) {
                    setState({
                        data: (result.data ?? []).map((table) => table.name),
                        loading: false,
                        error: null,
                    });
                }
            })
            .catch(() => {
                if (active) setState({ data: [], loading: false, error: '表加载失败' });
            });
        return () => { active = false; };
    }, [dataSourceId, database, groupId, retryKey]);

    return { ...state, retry };
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
    const [dataSources, setDataSources] = useState<DataSource[]>([]);

    useEffect(() => {
        if (!groupId) {
            setDataSources([]);
            return;
        }
        let active = true;
        void getDataSourcePage({
            groupId,
            page: 1,
            size: 200,
            status: 'ENABLED',
            type: supportedTransferDataSourceTypes.join(','),
        })
            .then((result) => {
                if (active) setDataSources(result.records ?? []);
            })
            .catch(() => {
                if (active) setDataSources([]);
            });
        return () => { active = false; };
    }, [groupId]);

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

    return { dataSources, source, target };
}
