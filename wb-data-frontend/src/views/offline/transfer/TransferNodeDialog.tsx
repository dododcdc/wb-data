import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import type { ColumnMetadata } from '../../../api/query';
import type { PartitionColumnMetadata } from '../../../api/transfer';
import { resolveTransferDatabaseSelection } from './transferDatabaseSelection';
import { reconcileTargetMappings } from './transferMapping';
import type {
    TransferConfig,
    TransferDataSourceType,
    TransferFieldMapping,
    TransferPartitionMapping,
} from './transferTypes';
import { validateTransferConfig } from './transferValidation';
import { useTransferMetadata } from './useTransferMetadata';
import { EndpointFields, ResourceError } from './TransferEndpointFields';
import { MappingRows, type TransferSchemaField } from './TransferMappingRows';
import './TransferNodeDialog.css';

export interface TransferNodeDraftState {
    valid: boolean;
    errors: string[];
}

interface TransferNodeDialogProps {
    groupId: number | null;
    value?: TransferConfig;
    onChange: (value: TransferConfig) => void;
    onDraftChange?: (value: TransferConfig, state: TransferNodeDraftState) => void;
    menuContainer?: HTMLElement | null;
}

const emptyConfig: TransferConfig = {
    source: { dataSourceId: 0, dataSourceType: 'MYSQL', table: '' },
    target: { dataSourceId: 0, dataSourceType: 'HIVE', table: '', writeMode: 'append' },
    fieldMappings: [],
    partitions: [],
};

function normalizeColumn(field: ColumnMetadata): TransferSchemaField {
    return field;
}

function normalizePartitionColumn(field: PartitionColumnMetadata): TransferSchemaField {
    return { ...field, partition: true };
}

function schemaFingerprint(fields: TransferSchemaField[]) {
    return JSON.stringify(fields.map((field) => [field.name, field.type, field.remarks]));
}

export function TransferNodeDialog({ groupId, value, onChange, onDraftChange, menuContainer }: TransferNodeDialogProps) {
    const [config, setConfig] = useState<TransferConfig>(value ?? emptyConfig);
    const emittedConfigRef = useRef('');
    const reportedDraftRef = useRef('');
    const reportedConfigRef = useRef('');
    const previousValueRef = useRef(JSON.stringify(value ?? emptyConfig));
    const refreshBaselineRef = useRef({ source: '', target: '' });
    const [refreshPhase, setRefreshPhase] = useState<'idle' | 'requested' | 'loading'>('idle');
    const [refreshMessage, setRefreshMessage] = useState('');
    const { dataSources, dataSourceSearch, source, target } = useTransferMetadata(
        groupId,
        config.source.dataSourceId || undefined,
        config.source.database,
        config.source.table,
        config.target.dataSourceId || undefined,
        config.target.database,
        config.target.table,
    );

    useEffect(() => {
        const next = JSON.stringify(value ?? emptyConfig);
        if (next === previousValueRef.current) return;
        previousValueRef.current = next;
        if (next !== reportedConfigRef.current) setConfig(value ?? emptyConfig);
    }, [value]);

    const sourceDataSource = dataSources.find((item) => item.id === config.source.dataSourceId);
    const targetDataSource = dataSources.find((item) => item.id === config.target.dataSourceId);
    const sourceDatabaseSelection = resolveTransferDatabaseSelection(
        config.source.database,
        sourceDataSource?.databaseName,
        source.databases.data,
    );
    const targetDatabaseSelection = resolveTransferDatabaseSelection(
        config.target.database,
        targetDataSource?.databaseName,
        target.databases.data,
    );
    const sourceDatabaseUnavailable = !source.databases.loading
        && !source.databases.error
        && source.databases.data.length > 0
        && sourceDatabaseSelection.unavailable;
    const targetDatabaseUnavailable = !target.databases.loading
        && !target.databases.error
        && target.databases.data.length > 0
        && targetDatabaseSelection.unavailable;

    useEffect(() => {
        if (source.databases.loading || source.databases.error
            || target.databases.loading || target.databases.error) return;
        setConfig((current) => {
            const selectedSource = dataSources.find((item) => item.id === current.source.dataSourceId);
            const selectedTarget = dataSources.find((item) => item.id === current.target.dataSourceId);
            const nextSource = resolveTransferDatabaseSelection(
                current.source.database,
                selectedSource?.databaseName,
                source.databases.data,
            ).database;
            const nextTarget = resolveTransferDatabaseSelection(
                current.target.database,
                selectedTarget?.databaseName,
                target.databases.data,
            ).database;
            if (nextSource === current.source.database && nextTarget === current.target.database) return current;
            return {
                ...current,
                source: { ...current.source, database: nextSource },
                target: { ...current.target, database: nextTarget },
            };
        });
    }, [
        dataSources,
        source.databases.data,
        source.databases.error,
        source.databases.loading,
        target.databases.data,
        target.databases.error,
        target.databases.loading,
    ]);

    const sourceMetadata = source.metadata.data;
    const targetMetadata = target.metadata.data;
    const sourceFields = useMemo(
        () => sourceMetadata?.columns.map(normalizeColumn) ?? [],
        [sourceMetadata],
    );
    const targetFields = useMemo(
        () => targetMetadata?.columns.map(normalizeColumn) ?? [],
        [targetMetadata],
    );
    const partitionFields = useMemo(
        () => targetMetadata?.partitionColumns.map(normalizePartitionColumn) ?? [],
        [targetMetadata],
    );
    const sourceColumns = useMemo(
        () => sourceFields.map((column) => column.name),
        [sourceFields],
    );
    const targetColumns = useMemo(
        () => targetFields.map((column) => column.name),
        [targetFields],
    );
    const partitionColumns = useMemo(
        () => partitionFields.map((column) => column.name),
        [partitionFields],
    );
    const writeModes = useMemo(
        () => targetMetadata?.writeModes.filter(
            (mode) => !(targetMetadata.partitioned && mode.value === 'overwrite_table'),
        ) ?? [],
        [targetMetadata],
    );

    const reconciledConfig = useMemo(() => {
        if (!config.source.table || !config.target.table || !sourceMetadata || !targetMetadata) return config;
        const next = {
            ...config,
            fieldMappings: reconcileTargetMappings(
                config.fieldMappings,
                sourceColumns,
                targetColumns,
            ),
            partitions: reconcileTargetMappings(
                config.partitions,
                sourceColumns,
                partitionColumns,
            ) as TransferPartitionMapping[],
            target: {
                ...config.target,
                writeMode: writeModes.some((mode) => mode.value === config.target.writeMode)
                    ? config.target.writeMode
                    : writeModes[0]?.value ?? 'append',
            },
        };
        return JSON.stringify(next) === JSON.stringify(config) ? config : next;
    }, [config, partitionColumns, sourceColumns, sourceMetadata, targetColumns, targetMetadata, writeModes]);

    useEffect(() => {
        if (reconciledConfig === config) return;
        setConfig((current) => current === config ? reconciledConfig : current);
    }, [config, reconciledConfig]);

    const validation = useMemo(
        () => validateTransferConfig(reconciledConfig, targetColumns, partitionColumns, sourceColumns),
        [partitionColumns, reconciledConfig, sourceColumns, targetColumns],
    );
    const validationErrors = useMemo(() => [
        ...validation.errors,
        ...(sourceDatabaseUnavailable ? ['已保存的来源数据库不可用，请重新选择'] : []),
        ...(targetDatabaseUnavailable ? ['已保存的目标数据库不可用，请重新选择'] : []),
    ], [sourceDatabaseUnavailable, targetDatabaseUnavailable, validation.errors]);
    const validationKey = validationErrors.join('\n');
    const writeModeValid = writeModes.some(
        (mode) => mode.value === (reconciledConfig.target.writeMode ?? 'append'),
    );
    const saveable = Boolean(
        reconciledConfig.source.database
        && reconciledConfig.target.database
        && sourceMetadata
        && targetMetadata
        && !sourceDatabaseUnavailable
        && !targetDatabaseUnavailable
        && validation.valid
        && writeModeValid,
    );

    useEffect(() => {
        const draftReport = JSON.stringify({ config: reconciledConfig, valid: saveable, errors: validationErrors });
        if (draftReport !== reportedDraftRef.current) {
            reportedDraftRef.current = draftReport;
            reportedConfigRef.current = JSON.stringify(reconciledConfig);
            onDraftChange?.(reconciledConfig, { valid: saveable, errors: validationErrors });
        }
        if (!saveable) return;
        const next = JSON.stringify(reconciledConfig);
        if (next !== emittedConfigRef.current) {
            emittedConfigRef.current = next;
            onChange(reconciledConfig);
        }
    }, [onChange, onDraftChange, reconciledConfig, saveable, validationErrors, validationKey]);

    const patch = (next: Partial<TransferConfig>) => {
        setConfig((current) => ({ ...current, ...next }));
    };
    const selectEndpoint = (side: 'source' | 'target', id: number) => {
        const selected = dataSources.find((item) => item.id === id);
        setConfig((current) => current[side].dataSourceId === id ? current : ({
            ...current,
            [side]: {
                ...current[side],
                ...(side === 'target' ? { preSql: undefined, postSql: undefined } : {}),
                dataSourceId: id,
                dataSourceType: (selected?.type ?? (side === 'source' ? 'MYSQL' : 'HIVE')) as TransferDataSourceType,
                database: undefined,
                table: '',
            },
            fieldMappings: [],
            partitions: [],
        }));
    };
    const selectDatabase = (side: 'source' | 'target', database: string) => {
        const nextDatabase = database || undefined;
        setConfig((current) => current[side].database === nextDatabase ? current : ({
            ...current,
            [side]: {
                ...current[side],
                ...(side === 'target' ? { preSql: undefined, postSql: undefined } : {}),
                database: nextDatabase,
                table: '',
            },
            fieldMappings: [],
            partitions: [],
        }));
    };
    const selectTable = (side: 'source' | 'target', table: string) => {
        setConfig((current) => current[side].table === table ? current : ({
            ...current,
            [side]: {
                ...current[side],
                ...(side === 'target' ? { preSql: undefined, postSql: undefined } : {}),
                table,
            },
            fieldMappings: [],
            partitions: [],
        }));
    };

    const endpointsConfigured = Boolean(
        reconciledConfig.source.dataSourceId
        && reconciledConfig.source.database
        && reconciledConfig.source.table
        && reconciledConfig.target.dataSourceId
        && reconciledConfig.target.database
        && reconciledConfig.target.table,
    );
    const metadataReady = Boolean(endpointsConfigured && sourceMetadata && targetMetadata);
    const targetHasFields = targetColumns.length > 0 || partitionColumns.length > 0;
    const metadataRefreshing = source.metadata.loading || target.metadata.loading;
    const sourceFingerprint = schemaFingerprint(sourceFields);
    const targetFingerprint = schemaFingerprint([...targetFields, ...partitionFields]);

    useEffect(() => {
        if (refreshPhase === 'requested' && metadataRefreshing) {
            setRefreshPhase('loading');
            return;
        }
        if (refreshPhase !== 'loading' || metadataRefreshing) return;

        const changed = refreshBaselineRef.current.source !== sourceFingerprint
            || refreshBaselineRef.current.target !== targetFingerprint;
        if (source.metadata.error || target.metadata.error) {
            setRefreshMessage('字段结构刷新失败，请重试');
        } else {
            setRefreshMessage(changed ? '字段结构已更新，请检查失效映射' : '字段结构已刷新，未发现变化');
        }
        setRefreshPhase('idle');
    }, [
        metadataRefreshing,
        refreshPhase,
        source.metadata.error,
        sourceFingerprint,
        target.metadata.error,
        targetFingerprint,
    ]);

    const refreshFieldStructures = () => {
        refreshBaselineRef.current = { source: sourceFingerprint, target: targetFingerprint };
        setRefreshMessage('正在刷新字段结构');
        setRefreshPhase('requested');
        source.metadata.retry();
        target.metadata.retry();
    };

    return (
        <div className="transfer-node-dialog" data-testid="transfer-node-dialog">
            <div className="transfer-node-grid">
                <EndpointFields
                    side="source"
                    title="来源"
                    config={reconciledConfig}
                    dataSources={dataSources}
                    dataSourceSearch={dataSourceSearch}
                    metadata={source}
                    databaseUnavailable={sourceDatabaseUnavailable}
                    onSelectDataSource={(id) => selectEndpoint('source', id)}
                    onSelectDatabase={(database) => selectDatabase('source', database)}
                    onSelectTable={(table) => selectTable('source', table)}
                    onPatch={patch}
                    writeModes={writeModes}
                    menuContainer={menuContainer}
                />
                <EndpointFields
                    side="target"
                    title="目标"
                    config={reconciledConfig}
                    dataSources={dataSources}
                    dataSourceSearch={dataSourceSearch}
                    metadata={target}
                    databaseUnavailable={targetDatabaseUnavailable}
                    onSelectDataSource={(id) => selectEndpoint('target', id)}
                    onSelectDatabase={(database) => selectDatabase('target', database)}
                    onSelectTable={(table) => selectTable('target', table)}
                    onPatch={patch}
                    writeModes={writeModes}
                    menuContainer={menuContainer}
                />
            </div>

            <section className="transfer-node-panel transfer-node-mappings-panel">
                <div className="transfer-node-panel-heading">
                    <h3>字段映射</h3>
                    <div className="transfer-node-mapping-actions">
                        {metadataReady && validation.unmappedTargetColumns.length > 0 && (
                            <span className="transfer-node-mapping-summary">
                                {validation.unmappedTargetColumns.length} 个目标字段待映射
                            </span>
                        )}
                        {metadataReady && (
                            <button
                                type="button"
                                className="transfer-node-refresh-fields"
                                aria-label="刷新字段结构"
                                title="重新读取来源表和目标表的字段结构"
                                disabled={metadataRefreshing || refreshPhase !== 'idle'}
                                onClick={refreshFieldStructures}
                            >
                                <RefreshCw size={14} className={metadataRefreshing ? 'is-spinning' : undefined} />
                                刷新字段结构
                            </button>
                        )}
                    </div>
                </div>
                {metadataReady && targetHasFields && (
                    <p className="transfer-node-field-help">
                        {'在画布参数中绑定参数组。固定值（含分区）按文本填写，支持 ^[参数名] 插值，不加 SQL 引号；SQL 表达式中的参数仅作值占位符，不要加引号。不支持动态数据库、表或字段名。'}
                    </p>
                )}
                {refreshMessage && <div className="transfer-node-refresh-message" role="status">{refreshMessage}</div>}
                {!endpointsConfigured && (
                    <div className="transfer-node-status transfer-node-status--empty">
                        <strong>完成来源和目标配置后生成字段映射</strong>
                        <span>系统会按目标表字段自动匹配同名源字段。</span>
                    </div>
                )}
                {endpointsConfigured && source.metadata.loading && <div className="transfer-node-status">正在加载来源字段</div>}
                {endpointsConfigured && target.metadata.loading && <div className="transfer-node-status">正在加载目标字段</div>}
                {source.metadata.error && (
                    <ResourceError
                        message={`来源${source.metadata.error}`}
                        retryLabel="重试来源字段"
                        onRetry={source.metadata.retry}
                    />
                )}
                {target.metadata.error && (
                    <ResourceError
                        message={`目标${target.metadata.error}`}
                        retryLabel="重试目标字段"
                        onRetry={target.metadata.retry}
                    />
                )}
                {metadataReady && !targetHasFields && (
                    <div className="transfer-node-status">目标表没有可传输字段</div>
                )}
                {metadataReady && (reconciledConfig.fieldMappings?.length ?? 0) > 0 && (
                    <MappingRows
                        mappings={reconciledConfig.fieldMappings}
                        sourceFields={sourceFields}
                        targetFields={targetFields}
                        targetLabel="目标字段"
                        menuContainer={menuContainer}
                        onChange={(fieldMappings) => patch({ fieldMappings: fieldMappings as TransferFieldMapping[] })}
                        onRemove={(removedTarget) => patch({
                            fieldMappings: reconciledConfig.fieldMappings?.filter(
                                (mapping) => mapping.target !== removedTarget,
                            ),
                        })}
                    />
                )}
            </section>

            {metadataReady && (targetMetadata?.partitioned || (reconciledConfig.partitions?.length ?? 0) > 0) && (
                <section className="transfer-node-panel transfer-node-mappings-panel">
                    <h3>分区映射</h3>
                    <MappingRows
                        mappings={reconciledConfig.partitions}
                        sourceFields={sourceFields}
                        targetFields={partitionFields}
                        targetLabel="分区字段"
                        menuContainer={menuContainer}
                        onChange={(partitions) => patch({ partitions: partitions as TransferPartitionMapping[] })}
                        onRemove={(removedTarget) => patch({
                            partitions: reconciledConfig.partitions?.filter(
                                (mapping) => mapping.target !== removedTarget,
                            ),
                        })}
                    />
                </section>
            )}

        </div>
    );
}
