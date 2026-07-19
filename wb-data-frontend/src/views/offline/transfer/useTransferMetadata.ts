import { useEffect, useState } from 'react';

import { getDataSourcePage, type DataSource } from '../../../api/datasource';
import { getTransferTableMetadata, getTransferTables, type TransferTableMetadataResponse } from '../../../api/transfer';
import type { TransferDataSourceType } from './transferTypes';

export const supportedTransferDataSourceTypes: TransferDataSourceType[] = ['MYSQL', 'POSTGRESQL', 'STARROCKS', 'HIVE'];

export function useTransferMetadata(groupId: number | null, sourceDataSourceId?: number, sourceDatabase?: string, sourceTable?: string, targetDataSourceId?: number, targetDatabase?: string, targetTable?: string) {
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [sourceTables, setSourceTables] = useState<string[]>([]);
    const [targetTables, setTargetTables] = useState<string[]>([]);
    const [targetMetadata, setTargetMetadata] = useState<TransferTableMetadataResponse | null>(null);
    const [sourceMetadata, setSourceMetadata] = useState<TransferTableMetadataResponse | null>(null);

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
        if (!groupId || !sourceDataSourceId || !sourceTable) { setSourceMetadata(null); return; }
        setSourceMetadata(null);
        void getTransferTableMetadata(groupId, sourceDataSourceId, sourceDatabase ?? '', sourceTable)
            .then(setSourceMetadata)
            .catch(() => setSourceMetadata(null));
    }, [groupId, sourceDataSourceId, sourceDatabase, sourceTable]);

    useEffect(() => {
        if (!groupId || !targetDataSourceId) { setTargetTables([]); return; }
        void getTransferTables(groupId, targetDataSourceId, { page: 1, size: 200 })
            .then((result) => setTargetTables((result.data ?? []).map((table) => table.name)))
            .catch(() => setTargetTables([]));
    }, [groupId, targetDataSourceId]);

    useEffect(() => {
        if (!groupId || !targetDataSourceId || !targetTable) { setTargetMetadata(null); return; }
        setTargetMetadata(null);
        void getTransferTableMetadata(groupId, targetDataSourceId, targetDatabase ?? '', targetTable)
            .then(setTargetMetadata)
            .catch(() => setTargetMetadata(null));
    }, [groupId, targetDataSourceId, targetDatabase, targetTable]);

    return { dataSources, sourceTables, targetTables, sourceMetadata, targetMetadata };
}
