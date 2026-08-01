import { useEffect, useMemo, useRef, useState } from 'react';

import type { DataSource } from '../../../api/datasource';
import type { TransferEndpointMetadataState } from './useTransferMetadata';
import { resolveTransferDatabaseSelection } from './transferDatabaseSelection';
import { reconcileTargetMappings, updateMapping } from './transferMapping';
import type {
    TransferConfig,
    TransferDataSourceType,
    TransferFieldMapping,
    TransferMappingKind,
    TransferPartitionMapping,
} from './transferTypes';
import { validateTransferConfig } from './transferValidation';
import { useTransferMetadata } from './useTransferMetadata';
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
}

interface MappingRowsProps {
    mappings: Array<TransferFieldMapping | TransferPartitionMapping> | undefined;
    sourceColumns: string[];
    errorPrefix: '目标字段' | '分区字段';
    onChange: (mappings: Array<TransferFieldMapping | TransferPartitionMapping>) => void;
}

interface EndpointFieldsProps {
    side: 'source' | 'target';
    title: string;
    config: TransferConfig;
    dataSources: DataSource[];
    metadata: TransferEndpointMetadataState;
    databaseUnavailable: boolean;
    onSelectDataSource: (id: number) => void;
    onSelectDatabase: (database: string) => void;
    onSelectTable: (table: string) => void;
    onPatch: (next: Partial<TransferConfig>) => void;
    writeModes: Array<{ value: TransferConfig['target']['writeMode']; label: string }>;
}

const emptyConfig: TransferConfig = {
    source: { dataSourceId: 0, dataSourceType: 'MYSQL', table: '' },
    target: { dataSourceId: 0, dataSourceType: 'HIVE', table: '', writeMode: 'append' },
    fieldMappings: [],
    partitions: [],
};

function MappingRows({ mappings, sourceColumns, errorPrefix, onChange }: MappingRowsProps) {
    return <>{(mappings ?? []).map((mapping) => {
        const value = mapping.source ?? mapping.value ?? mapping.expression ?? '';
        const error = value ? null : `${errorPrefix} ${mapping.target} 尚未配置映射`;
        return (
            <div className={`transfer-node-mapping${error ? ' is-invalid' : ''}`} key={mapping.target}>
                <strong>{mapping.target}</strong>
                <select
                    aria-label={`${mapping.target} 映射类型`}
                    value={mapping.kind}
                    onChange={(event) => onChange(updateMapping(
                        mappings ?? [],
                        mapping.target,
                        event.target.value as TransferMappingKind,
                        value,
                    ))}
                >
                    <option value="source_field">源字段</option>
                    <option value="static_value">静态值</option>
                    <option value="source_expression">源表达式</option>
                </select>
                {mapping.kind === 'source_field' ? (
                    <select
                        aria-label={`${mapping.target} 源字段`}
                        value={value}
                        onChange={(event) => onChange(updateMapping(
                            mappings ?? [],
                            mapping.target,
                            mapping.kind,
                            event.target.value,
                        ))}
                    >
                        <option value="">选择字段</option>
                        {sourceColumns.map((column) => <option key={column} value={column}>{column}</option>)}
                    </select>
                ) : (
                    <input
                        aria-label={`${mapping.target} 映射值`}
                        value={value}
                        onChange={(event) => onChange(updateMapping(
                            mappings ?? [],
                            mapping.target,
                            mapping.kind,
                            event.target.value,
                        ))}
                        placeholder={mapping.kind === 'static_value' ? '静态值' : '源端表达式'}
                    />
                )}
                {error && <span className="transfer-node-mapping-error">{error}</span>}
            </div>
        );
    })}</>;
}

function ResourceError({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
    return (
        <div className="transfer-node-resource-error">
            <span>{message}</span>
            <button type="button" aria-label={retryLabel} onClick={onRetry}>重试</button>
        </div>
    );
}

function EndpointFields({
    side,
    title,
    config,
    dataSources,
    metadata,
    databaseUnavailable,
    onSelectDataSource,
    onSelectDatabase,
    onSelectTable,
    onPatch,
    writeModes,
}: EndpointFieldsProps) {
    const endpoint = config[side];
    const sideLabel = side === 'source' ? '来源' : '目标';
    const tableDisabled = !endpoint.dataSourceId
        || !endpoint.database
        || metadata.databases.loading
        || Boolean(metadata.databases.error)
        || metadata.tables.loading;

    return (
        <section className="transfer-node-panel">
            <h3>{title}</h3>
            <label className="transfer-node-field">
                数据源
                <select
                    value={endpoint.dataSourceId || ''}
                    onChange={(event) => onSelectDataSource(Number(event.target.value))}
                >
                    <option value="">选择数据源</option>
                    {dataSources.map((dataSource) => (
                        <option key={dataSource.id} value={dataSource.id}>
                            {dataSource.name} ({dataSource.type})
                        </option>
                    ))}
                </select>
            </label>
            <label className="transfer-node-field">
                数据库
                <select
                    value={endpoint.database ?? ''}
                    disabled={!endpoint.dataSourceId || metadata.databases.loading}
                    onChange={(event) => onSelectDatabase(event.target.value)}
                >
                    <option value="">选择数据库</option>
                    {databaseUnavailable && endpoint.database && (
                        <option value={endpoint.database}>{endpoint.database}（不可用）</option>
                    )}
                    {metadata.databases.data.map((database) => (
                        <option key={database} value={database}>{database}</option>
                    ))}
                </select>
            </label>
            {metadata.databases.error && (
                <ResourceError
                    message={`${sideLabel}${metadata.databases.error}`}
                    retryLabel={`重试${sideLabel}数据库`}
                    onRetry={metadata.databases.retry}
                />
            )}
            {databaseUnavailable && (
                <div className="transfer-node-inline-error">
                    已保存的{sideLabel}数据库不可用，请重新选择
                </div>
            )}
            <label className="transfer-node-field">
                表
                <select
                    value={endpoint.table}
                    disabled={tableDisabled}
                    onChange={(event) => onSelectTable(event.target.value)}
                >
                    <option value="">选择表</option>
                    {metadata.tables.data.map((table) => <option key={table} value={table}>{table}</option>)}
                </select>
            </label>
            {metadata.tables.error && (
                <ResourceError
                    message={`${sideLabel}${metadata.tables.error}`}
                    retryLabel={`重试${sideLabel}表`}
                    onRetry={metadata.tables.retry}
                />
            )}
            {side === 'source' ? (
                <label className="transfer-node-field">
                    筛选条件（谓词片段）
                    <input
                        value={config.source.where ?? ''}
                        onChange={(event) => onPatch({
                            source: { ...config.source, where: event.target.value },
                        })}
                        placeholder="status = 'ACTIVE'"
                    />
                </label>
            ) : (
                <label className="transfer-node-field">
                    写入方式
                    <select
                        value={config.target.writeMode ?? 'append'}
                        disabled={!metadata.metadata.data || metadata.metadata.loading}
                        onChange={(event) => onPatch({
                            target: {
                                ...config.target,
                                writeMode: event.target.value as TransferConfig['target']['writeMode'],
                            },
                        })}
                    >
                        {writeModes.map((mode) => (
                            <option key={mode.value} value={mode.value}>{mode.label}</option>
                        ))}
                        {!writeModes.length && <option value="append">加载目标表后可选择</option>}
                    </select>
                </label>
            )}
        </section>
    );
}

export function TransferNodeDialog({ groupId, value, onChange, onDraftChange }: TransferNodeDialogProps) {
    const [config, setConfig] = useState<TransferConfig>(value ?? emptyConfig);
    const emittedConfigRef = useRef('');
    const reportedDraftRef = useRef('');
    const reportedConfigRef = useRef('');
    const previousValueRef = useRef(JSON.stringify(value ?? emptyConfig));
    const { dataSources, source, target } = useTransferMetadata(
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
    const sourceColumns = useMemo(
        () => sourceMetadata?.columns.map((column) => column.name) ?? [],
        [sourceMetadata],
    );
    const targetColumns = useMemo(
        () => targetMetadata?.columns.map((column) => column.name) ?? [],
        [targetMetadata],
    );
    const partitionColumns = useMemo(
        () => targetMetadata?.partitionColumns.map((column) => column.name) ?? [],
        [targetMetadata],
    );
    const writeModes = useMemo(
        () => targetMetadata?.writeModes.filter(
            (mode) => !(targetMetadata.partitioned && mode.value === 'overwrite_table'),
        ) ?? [],
        [targetMetadata],
    );

    useEffect(() => {
        if (!sourceMetadata || !targetMetadata) return;
        setConfig((current) => ({
            ...current,
            fieldMappings: reconcileTargetMappings(
                current.fieldMappings,
                sourceColumns,
                targetColumns,
            ),
            partitions: reconcileTargetMappings(
                current.partitions,
                sourceColumns,
                partitionColumns,
            ) as TransferPartitionMapping[],
            target: {
                ...current.target,
                writeMode: writeModes.some((mode) => mode.value === current.target.writeMode)
                    ? current.target.writeMode
                    : writeModes[0]?.value ?? 'append',
            },
        }));
    }, [partitionColumns, sourceColumns, sourceMetadata, targetColumns, targetMetadata, writeModes]);

    const validation = useMemo(
        () => validateTransferConfig(config, targetColumns, partitionColumns),
        [config, partitionColumns, targetColumns],
    );
    const validationErrors = useMemo(() => [
        ...validation.errors,
        ...(sourceDatabaseUnavailable ? ['已保存的来源数据库不可用，请重新选择'] : []),
        ...(targetDatabaseUnavailable ? ['已保存的目标数据库不可用，请重新选择'] : []),
    ], [sourceDatabaseUnavailable, targetDatabaseUnavailable, validation.errors]);
    const validationKey = validationErrors.join('\n');
    const writeModeValid = writeModes.some((mode) => mode.value === (config.target.writeMode ?? 'append'));
    const saveable = Boolean(
        config.source.database
        && config.target.database
        && sourceMetadata
        && targetMetadata
        && !sourceDatabaseUnavailable
        && !targetDatabaseUnavailable
        && validation.valid
        && writeModeValid,
    );

    useEffect(() => {
        const draftReport = JSON.stringify({ config, valid: saveable, errors: validationErrors });
        if (draftReport !== reportedDraftRef.current) {
            reportedDraftRef.current = draftReport;
            reportedConfigRef.current = JSON.stringify(config);
            onDraftChange?.(config, { valid: saveable, errors: validationErrors });
        }
        if (!saveable) return;
        const next = JSON.stringify(config);
        if (next !== emittedConfigRef.current) {
            emittedConfigRef.current = next;
            onChange(config);
        }
    }, [config, onChange, onDraftChange, saveable, validationErrors, validationKey]);

    const patch = (next: Partial<TransferConfig>) => {
        setConfig((current) => ({ ...current, ...next }));
    };
    const selectEndpoint = (side: 'source' | 'target', id: number) => {
        const selected = dataSources.find((item) => item.id === id);
        setConfig((current) => ({
            ...current,
            [side]: {
                ...current[side],
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
        setConfig((current) => ({
            ...current,
            [side]: { ...current[side], database: database || undefined, table: '' },
            fieldMappings: [],
            partitions: [],
        }));
    };
    const selectTable = (side: 'source' | 'target', table: string) => {
        setConfig((current) => ({
            ...current,
            [side]: { ...current[side], table },
            fieldMappings: [],
            partitions: [],
        }));
    };

    const tablesSelected = Boolean(config.source.table && config.target.table);
    const metadataReady = Boolean(sourceMetadata && targetMetadata);
    const targetHasFields = targetColumns.length > 0 || partitionColumns.length > 0;

    return (
        <div className="transfer-node-dialog" data-testid="transfer-node-dialog">
            <div className="transfer-node-grid">
                <EndpointFields
                    side="source"
                    title="来源"
                    config={config}
                    dataSources={dataSources}
                    metadata={source}
                    databaseUnavailable={sourceDatabaseUnavailable}
                    onSelectDataSource={(id) => selectEndpoint('source', id)}
                    onSelectDatabase={(database) => selectDatabase('source', database)}
                    onSelectTable={(table) => selectTable('source', table)}
                    onPatch={patch}
                    writeModes={writeModes}
                />
                <EndpointFields
                    side="target"
                    title="目标"
                    config={config}
                    dataSources={dataSources}
                    metadata={target}
                    databaseUnavailable={targetDatabaseUnavailable}
                    onSelectDataSource={(id) => selectEndpoint('target', id)}
                    onSelectDatabase={(database) => selectDatabase('target', database)}
                    onSelectTable={(table) => selectTable('target', table)}
                    onPatch={patch}
                    writeModes={writeModes}
                />
            </div>

            <section className="transfer-node-panel transfer-node-mappings-panel">
                <h3>目标普通字段</h3>
                {!tablesSelected && <div className="transfer-node-status">请选择来源表和目标表</div>}
                {source.metadata.loading && <div className="transfer-node-status">正在加载来源字段</div>}
                {target.metadata.loading && <div className="transfer-node-status">正在加载目标字段</div>}
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
                {metadataReady && targetColumns.length > 0 && (
                    <MappingRows
                        mappings={config.fieldMappings}
                        sourceColumns={sourceColumns}
                        errorPrefix="目标字段"
                        onChange={(fieldMappings) => patch({ fieldMappings: fieldMappings as TransferFieldMapping[] })}
                    />
                )}
            </section>

            {metadataReady && targetMetadata?.partitioned && (
                <section className="transfer-node-panel transfer-node-mappings-panel">
                    <h3>Hive 分区字段</h3>
                    <MappingRows
                        mappings={config.partitions}
                        sourceColumns={sourceColumns}
                        errorPrefix="分区字段"
                        onChange={(partitions) => patch({ partitions: partitions as TransferPartitionMapping[] })}
                    />
                </section>
            )}

            {validation.errors.length > 0 && (
                <div className="transfer-node-errors">
                    {validation.errors.map((error) => <div key={error}>{error}</div>)}
                </div>
            )}
        </div>
    );
}
