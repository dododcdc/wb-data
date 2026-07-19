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
        let active = true;
        setSourceTables([]);
        void getTransferTables(groupId, sourceDataSourceId, { page: 1, size: 200 })
            .then((result) => { if (active) setSourceTables((result.data ?? []).map((table) => table.name)); })
            .catch(() => { if (active) setSourceTables([]); });
        return () => { active = false; };
    }, [groupId, sourceDataSourceId]);

    useEffect(() => {
        if (!groupId || !sourceDataSourceId || !sourceTable) { setSourceMetadataState(null); return; }
        let active = true;
        const database = sourceDatabase ?? '';
        setSourceMetadataState(null);
        void getTransferTableMetadata(groupId, sourceDataSourceId, sourceDatabase ?? '', sourceTable)
            .then((metadata) => {
                if (active) setSourceMetadataState({ dataSourceId: sourceDataSourceId, database, table: sourceTable, metadata });
            })
            .catch(() => {
                if (active) setSourceMetadataState(null);
            });
        return () => { active = false; };
    }, [groupId, sourceDataSourceId, sourceDatabase, sourceTable]);

    useEffect(() => {
        if (!groupId || !targetDataSourceId) { setTargetTables([]); return; }
        let active = true;
        setTargetTables([]);
        void getTransferTables(groupId, targetDataSourceId, { page: 1, size: 200 })
            .then((result) => { if (active) setTargetTables((result.data ?? []).map((table) => table.name)); })
            .catch(() => { if (active) setTargetTables([]); });
        return () => { active = false; };
    }, [groupId, targetDataSourceId]);

    useEffect(() => {
        if (!groupId || !targetDataSourceId || !targetTable) { setTargetMetadataState(null); return; }
        let active = true;
        const database = targetDatabase ?? '';
        setTargetMetadataState(null);
        void getTransferTableMetadata(groupId, targetDataSourceId, targetDatabase ?? '', targetTable)
            .then((metadata) => {
                if (active) setTargetMetadataState({ dataSourceId: targetDataSourceId, database, table: targetTable, metadata });
            })
            .catch(() => {
                if (active) setTargetMetadataState(null);
            });
        return () => { active = false; };
    }, [groupId, targetDataSourceId, targetDatabase, targetTable]);

    const sourceMetadata = metadataMatchesSelection(sourceMetadataState, sourceDataSourceId, sourceDatabase, sourceTable)
        ? sourceMetadataState?.metadata ?? null
        : null;
    const targetMetadata = metadataMatchesSelection(targetMetadataState, targetDataSourceId, targetDatabase, targetTable)
        ? targetMetadataState?.metadata ?? null
        : null;

    return { dataSources, sourceTables, targetTables, sourceMetadata, targetMetadata };
}
