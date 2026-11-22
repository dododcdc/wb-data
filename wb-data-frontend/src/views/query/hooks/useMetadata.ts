import { useCallback, useEffect, useRef } from 'react';
import { useQueryDataSources } from './useQueryDataSources';
import { useQueryDatabasesAndDialect } from './useQueryDatabasesAndDialect';
import { useQueryTablesAndColumns } from './useQueryTablesAndColumns';

export function useMetadata(groupId: number | undefined) {
    const prepareDbChangeRef = useRef<(nextDataSourceId: string, isSwitch: boolean) => void>(() => undefined);
    const activeDsIdRef = useRef('');
    const activeDbRef = useRef('');

    const onBeforeDataSourceChange = useCallback((nextDataSourceId: string, isSwitch: boolean) => {
        prepareDbChangeRef.current(nextDataSourceId, isSwitch);
    }, []);

    const dataSourceState = useQueryDataSources({
        groupId,
        onBeforeDataSourceChange,
    });

    const databaseAndDialectState = useQueryDatabasesAndDialect({
        groupId,
        selectedDsId: dataSourceState.selectedDsId,
        selectedDs: dataSourceState.selectedDs,
        dataSources: dataSourceState.dataSources,
        selectionIntent: dataSourceState.selectionIntent,
        onBackfillDataSourceDefault: dataSourceState.updateSelectedDsDefaultDatabase,
    });

    prepareDbChangeRef.current = databaseAndDialectState.prepareForDataSourceChange;

    useEffect(() => {
        activeDsIdRef.current = dataSourceState.selectedDsId;
    }, [dataSourceState.selectedDsId]);

    useEffect(() => {
        activeDbRef.current = databaseAndDialectState.selectedDb;
    }, [databaseAndDialectState.selectedDb]);

    const tableAndColumnState = useQueryTablesAndColumns({
        groupId,
        selectedDsId: dataSourceState.selectedDsId,
        selectedDb: databaseAndDialectState.selectedDb,
        activeDsIdRef,
        activeDbRef,
    });

    return {
        // Data source
        dataSources: dataSourceState.dataSources,
        selectedDsId: dataSourceState.selectedDsId,
        selectedDs: dataSourceState.selectedDs,
        defaultDsId: dataSourceState.defaultDsId,
        dsKeyword: dataSourceState.dsKeyword,
        loadingDs: dataSourceState.loadingDs,
        loadingDsMore: dataSourceState.loadingDsMore,
        dsHasMore: dataSourceState.dsHasMore,
        selectedDsOption: dataSourceState.selectedDsOption,
        dataSourceOptions: dataSourceState.dataSourceOptions,
        setDsKeyword: dataSourceState.setDsKeyword,
        setSelectedDb: databaseAndDialectState.setSelectedDb,
        applySelectedDataSource: dataSourceState.applySelectedDataSource,
        loadMoreDataSources: dataSourceState.loadMoreDataSources,
        toggleDefaultDataSource: dataSourceState.toggleDefaultDataSource,
        getActiveDataSource: dataSourceState.getActiveDataSource,

        // Database
        databases: databaseAndDialectState.databases,
        selectedDb: databaseAndDialectState.selectedDb,
        dbKeyword: databaseAndDialectState.dbKeyword,
        loadingDatabases: databaseAndDialectState.loadingDatabases,
        filteredDatabases: databaseAndDialectState.filteredDatabases,
        databaseOptions: databaseAndDialectState.databaseOptions,
        selectedDbOption: databaseAndDialectState.selectedDbOption,
        setDbKeyword: databaseAndDialectState.setDbKeyword,

        // Table
        tables: tableAndColumnState.tables,
        tableKeyword: tableAndColumnState.tableKeyword,
        tableKeywordCommitted: tableAndColumnState.tableKeywordCommitted,
        tableTotal: tableAndColumnState.tableTotal,
        loadingTables: tableAndColumnState.loadingTables,
        loadingMoreTables: tableAndColumnState.loadingMoreTables,
        tableHasMore: tableAndColumnState.tableHasMore,
        expandedTables: tableAndColumnState.expandedTables,
        setTableKeyword: tableAndColumnState.setTableKeyword,
        setTableKeywordCommitted: tableAndColumnState.setTableKeywordCommitted,
        handleTableScroll: tableAndColumnState.handleTableScroll,
        handleTableScrollRef: tableAndColumnState.handleTableScrollRef,
        toggleTableExpand: tableAndColumnState.toggleTableExpand,
        tableScrollElement: tableAndColumnState.tableScrollElement,

        // Column
        columnCache: tableAndColumnState.columnCache,
        loadingColumns: tableAndColumnState.loadingColumns,
        loadColumns: tableAndColumnState.loadColumns,

        // Dialect
        dialectMetadata: databaseAndDialectState.dialectMetadata,

        // Refs exposed for external use (e.g., useSqlCompletion)
        activeDsIdRef,
        activeDbRef,
    };
}
