import { useEffect, useState } from 'react';

import { getDataSourcePage, type DataSource } from '../../../api/datasource';
import { getTransferTableMetadata, getTransferTables, type TransferTableMetadataResponse } from '../../../api/transfer';
import type { TransferDataSourceType } from './transferTypes';

export const supportedTransferDataSourceTypes: TransferDataSourceType[] = ['MYSQL', 'POSTGRESQL', 'STARROCKS', 'HIVE'];

interface TransferMetadataState {
    dataSourceId: number;
    database: string;
    table: string;
    metadata: TransferTableMetadataResponse;
}

function metadataMatchesSelection(
    state: TransferMetadataState | null,
    dataSourceId: number | undefined,
    database: string | undefined,
    table: string | undefined,
) {
    return Boolean(
        state
        && dataSourceId
        && table
        && state.dataSourceId === dataSourceId
        && state.database === (database ?? '')
        && state.table === table,
    );
}

export function useTransferMetadata(groupId: number | null, sourceDataSourceId?: number, sourceDatabase?: string, sourceTable?: string, targetDataSourceId?: number, targetDatabase?: string, targetTable?: string) {
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [sourceTables, setSourceTables] = useState<string[]>([]);
    const [targetTables, setTargetTables] = useState<string[]>([]);
    const [targetMetadataState, setTargetMetadataState] = useState<TransferMetadataState | null>(null);
    const [sourceMetadataState, setSourceMetadataState] = useState<TransferMetadataState | null>(null);

    useEffect(() => {
        if (!groupId) return;
        void getDataSourcePage({ groupId, page: 1, size: 200, status: 'ENABLED', type: supportedTransferDataSourceTypes.join(',') })
            .then((result) => setDataSources(result.records ?? []))
            .catch(() => setDataSources([]));
    }, [groupId]);

    useEffect(() => {
        if (!groupId || !sourceDataSourceId) { setSourceTables([]); return; }
        void getTransferTables(groupId, sourceDataSourceId, { page: 1, size: 200 })
            .then((result) => setSourceTables((result.data ?? []).map((table) => table.name)))
            .catch(() => setSourceTables([]));
    }, [groupId, sourceDataSourceId]);

    useEffect(() => {
        if (!groupId || !sourceDataSourceId || !sourceTable) { setSourceMetadataState(null); return; }
        const database = sourceDatabase ?? '';
        setSourceMetadataState(null);
        void getTransferTableMetadata(groupId, sourceDataSourceId, sourceDatabase ?? '', sourceTable)
            .then((metadata) => setSourceMetadataState({ dataSourceId: sourceDataSourceId, database, table: sourceTable, metadata }))
            .catch(() => setSourceMetadataState(null));
    }, [groupId, sourceDataSourceId, sourceDatabase, sourceTable]);

    useEffect(() => {
        if (!groupId || !targetDataSourceId) { setTargetTables([]); return; }
        void getTransferTables(groupId, targetDataSourceId, { page: 1, size: 200 })
            .then((result) => setTargetTables((result.data ?? []).map((table) => table.name)))
            .catch(() => setTargetTables([]));
    }, [groupId, targetDataSourceId]);

    useEffect(() => {
        if (!groupId || !targetDataSourceId || !targetTable) { setTargetMetadataState(null); return; }
        const database = targetDatabase ?? '';
        setTargetMetadataState(null);
        void getTransferTableMetadata(groupId, targetDataSourceId, targetDatabase ?? '', targetTable)
            .then((metadata) => setTargetMetadataState({ dataSourceId: targetDataSourceId, database, table: targetTable, metadata }))
            .catch(() => setTargetMetadataState(null));
    }, [groupId, targetDataSourceId, targetDatabase, targetTable]);

    const sourceMetadata = metadataMatchesSelection(sourceMetadataState, sourceDataSourceId, sourceDatabase, sourceTable)
        ? sourceMetadataState?.metadata ?? null
        : null;
    const targetMetadata = metadataMatchesSelection(targetMetadataState, targetDataSourceId, targetDatabase, targetTable)
        ? targetMetadataState?.metadata ?? null
        : null;

    return { dataSources, sourceTables, targetTables, sourceMetadata, targetMetadata };
}
