import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Maximize2, Minimize2, RefreshCw, Trash2 } from 'lucide-react';

import type { DataSource } from '../../../api/datasource';
import type { ColumnMetadata } from '../../../api/query';
import type { PartitionColumnMetadata } from '../../../api/transfer';
import {
    SearchAutocomplete,
    type SearchAutocompleteOption,
} from '../../../components/ui/search-autocomplete';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from '../../../components/ui/select';
import type { TransferEndpointMetadataState, TransferPagedResource } from './useTransferMetadata';
import { resolveTransferDatabaseSelection } from './transferDatabaseSelection';
import { reconcileTargetMappings, updateMapping } from './transferMapping';
import type {
    TransferConfig,
    TransferDataSourceType,
    TransferFieldMapping,
    TransferMappingKind,
    TransferPartitionMapping,
    TransferWriteMode,
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
    menuContainer?: HTMLElement | null;
}

interface MappingRowsProps {
    mappings: Array<TransferFieldMapping | TransferPartitionMapping> | undefined;
    sourceFields: TransferSchemaField[];
    targetFields: TransferSchemaField[];
    targetLabel: '目标字段' | '分区字段';
    menuContainer?: HTMLElement | null;
    onChange: (mappings: Array<TransferFieldMapping | TransferPartitionMapping>) => void;
    onRemove: (target: string) => void;
}

interface TransferSchemaField {
    name: string;
    type: string;
    remarks: string;
    size?: number;
    nullable?: boolean;
    primaryKey?: boolean;
    partition?: boolean;
}

interface EndpointFieldsProps {
    side: 'source' | 'target';
    title: string;
    config: TransferConfig;
    dataSources: DataSource[];
    dataSourceSearch: TransferPagedResource<DataSource>;
    metadata: TransferEndpointMetadataState;
    databaseUnavailable: boolean;
    onSelectDataSource: (id: number) => void;
    onSelectDatabase: (database: string) => void;
    onSelectTable: (table: string) => void;
    onPatch: (next: Partial<TransferConfig>) => void;
    writeModes: Array<{ value: TransferWriteMode; label: string }>;
    menuContainer?: HTMLElement | null;
}

interface TransferSearchSelectProps {
    ariaLabel: string;
    value: string;
    options: SearchAutocompleteOption[];
    placeholder: string;
    disabled?: boolean;
    loading?: boolean;
    loadingMore?: boolean;
    hasMore?: boolean;
    emptyText?: string;
    virtualize?: boolean;
    menuContainer?: HTMLElement | null;
    contentClassName?: string;
    onChange: (value: string) => void;
    onSearch?: (keyword: string) => void;
    onLoadMore?: () => void;
}

const emptyConfig: TransferConfig = {
    source: { dataSourceId: 0, dataSourceType: 'MYSQL', table: '' },
    target: { dataSourceId: 0, dataSourceType: 'HIVE', table: '', writeMode: 'append' },
    fieldMappings: [],
    partitions: [],
};

const mappingKindOptions: Array<{ value: TransferMappingKind; label: string }> = [
    { value: 'source_field', label: '源字段' },
    { value: 'static_value', label: '固定值' },
    { value: 'source_expression', label: 'SQL 表达式' },
];

function normalizeColumn(field: ColumnMetadata): TransferSchemaField {
    return field;
}

function normalizePartitionColumn(field: PartitionColumnMetadata): TransferSchemaField {
    return { ...field, partition: true };
}

function schemaFingerprint(fields: TransferSchemaField[]) {
    return JSON.stringify(fields.map((field) => [field.name, field.type, field.remarks]));
}

function TransferSearchSelect({
    ariaLabel,
    value,
    options,
    placeholder,
    disabled,
    loading,
    loadingMore,
    hasMore,
    emptyText,
    virtualize,
    menuContainer,
    contentClassName,
    onChange,
    onSearch,
    onLoadMore,
}: TransferSearchSelectProps) {
    const selectedOption = useMemo(
        () => options.find((option) => option.value === value)
            ?? (value ? { label: value, value } : null),
        [options, value],
    );

    return (
        <SearchAutocomplete
            ariaLabel={ariaLabel}
            className="transfer-node-search-select"
            contentClassName={contentClassName}
            options={options}
            value={value || undefined}
            selectedOption={selectedOption}
            placeholder={placeholder}
            clearInputOnOpen
            disabled={disabled}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            emptyText={emptyText}
            virtualize={virtualize}
            virtualItemSize={32}
            menuContainer={menuContainer}
            onChange={(nextValue) => {
                onSearch?.('');
                onChange(nextValue);
            }}
            onInputChange={onSearch}
            onLoadMore={onLoadMore}
            onOpenChange={(open) => {
                if (!open) onSearch?.('');
            }}
        />
    );
}

function FieldDetails({ field, side }: { field: TransferSchemaField; side: 'source' | 'target' }) {
    const description = field.remarks || '无描述';
    return (
        <div className={`transfer-node-field-details transfer-node-field-details--${side}`}>
            {side === 'target' && <strong>{field.name}</strong>}
            <span className="transfer-node-field-type">{field.type || '未知类型'}</span>
            <span className="transfer-node-field-flag-slot">
                {field.primaryKey && <span className="transfer-node-field-flag">主键</span>}
            </span>
            <span className="transfer-node-field-flag-slot">
                {field.partition && <span className="transfer-node-field-flag">分区</span>}
            </span>
            {side === 'target' && (
                <span className="transfer-node-field-flag-slot">
                    {field.nullable === false && <span className="transfer-node-field-flag">非空</span>}
                </span>
            )}
            <span className="transfer-node-field-description" title={description}>
                {description}
            </span>
        </div>
    );
}

function MappingRows({
    mappings,
    sourceFields,
    targetFields,
    targetLabel,
    menuContainer,
    onChange,
    onRemove,
}: MappingRowsProps) {
    const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
    const sourceOptions = useMemo<SearchAutocompleteOption[]>(() => sourceFields.map((field) => ({
        value: field.name,
        label: field.name,
        secondaryLabel: field.type,
        raw: field,
    })), [sourceFields]);
    const sourceByName = useMemo(
        () => new Map(sourceFields.map((field) => [field.name, field])),
        [sourceFields],
    );
    const targetByName = useMemo(
        () => new Map(targetFields.map((field) => [field.name, field])),
        [targetFields],
    );

    return <div className="transfer-node-mapping-matrix">
        <div className="transfer-node-mapping-columns" aria-hidden="true">
            <span>来源字段 / 配置值</span>
            <span>映射方式</span>
            <span>{targetLabel}</span>
        </div>
        {(mappings ?? []).map((mapping) => {
            const value = mapping.source ?? mapping.value ?? mapping.expression ?? '';
            const sourceField = mapping.kind === 'source_field' ? sourceByName.get(value) : undefined;
            const targetField = targetByName.get(mapping.target);
            const staleTarget = !targetField;
            const error = staleTarget
                ? `${targetLabel}已不存在`
                : mapping.kind === 'source_field' && !value
                    ? '请选择来源字段'
                    : mapping.kind === 'source_field' && !sourceField
                        ? `来源字段 ${value} 已不存在`
                        : !value
                            ? `请输入${mapping.kind === 'static_value' ? '固定值' : 'SQL 表达式'}`
                            : null;
            const isTouched = Boolean(touchedFields[mapping.target]);
            const showInvalid = Boolean(
                staleTarget
                || (mapping.kind === 'source_field' && (!value || !sourceField))
                || ((mapping.kind === 'static_value' || mapping.kind === 'source_expression') && !value && isTouched),
            );
            const selectedSourceOption = sourceOptions.find((option) => option.value === value)
                ?? (value ? { value, label: `${value}（已不存在）` } : null);
            return (
                <div
                    className={`transfer-node-mapping${showInvalid ? ' is-invalid' : ''}`}
                    data-target-field={mapping.target}
                    key={mapping.target}
                >
                <div className="transfer-node-mapping-source">
                    {mapping.kind === 'source_field' ? (
                        <>
                            <SearchAutocomplete
                                ariaLabel={`${mapping.target} 源字段`}
                                className="transfer-node-mapping-source-select"
                                contentClassName="min-w-[320px] max-w-[calc(100vw-32px)]"
                                options={sourceOptions}
                                value={value || undefined}
                                selectedOption={selectedSourceOption}
                                placeholder="选择来源字段"
                                clearInputOnOpen
                                menuContainer={menuContainer}
                                onChange={(nextValue) => onChange(updateMapping(
                                    mappings ?? [],
                                    mapping.target,
                                    mapping.kind,
                                    nextValue,
                                ))}
                                renderItem={(option) => {
                                    const field = option.raw as TransferSchemaField;
                                    return (
                                        <div className="transfer-node-field-option">
                                            <span><strong>{field.name}</strong><small>{field.type}</small></span>
                                            {field.remarks && <small>{field.remarks}</small>}
                                        </div>
                                    );
                                }}
                            />
                            {sourceField && <FieldDetails field={sourceField} side="source" />}
                        </>
                    ) : (
                        <input
                            aria-label={`${mapping.target} 映射值`}
                            value={value}
                            aria-invalid={showInvalid}
                            onBlur={() => setTouchedFields((prev) => ({ ...prev, [mapping.target]: true }))}
                            onChange={(event) => onChange(updateMapping(
                                mappings ?? [],
                                mapping.target,
                                mapping.kind,
                                event.target.value,
                            ))}
                            placeholder={
                                mapping.kind === 'static_value'
                                    ? "例如: 100 或 'ACTIVE'"
                                    : "例如: CONCAT(col, '_ext')"
                            }
                        />
                    )}
                    {error && !staleTarget && (mapping.kind === 'source_field' || Boolean(value) || isTouched) && (
                        <span className="transfer-node-mapping-error">{error}</span>
                    )}
                </div>
                <div className="transfer-node-mapping-kind">
                    <Select
                        value={mapping.kind}
                        onValueChange={(nextKind) => {
                            if (!nextKind) return;
                            setTouchedFields((prev) => ({ ...prev, [mapping.target]: false }));
                            onChange(updateMapping(
                                mappings ?? [],
                                mapping.target,
                                nextKind as TransferMappingKind,
                                nextKind === mapping.kind ? value : '',
                            ));
                        }}
                    >
                        <SelectTrigger
                            aria-label={`${mapping.target} 映射类型`}
                            aria-invalid={Boolean(staleTarget || (mapping.kind === 'source_field' && (!value || !sourceField)))}
                            className="transfer-node-mapping-kind-trigger"
                        >
                            <span data-slot="select-value" className="flex flex-1 text-left">
                                {mappingKindOptions.find((option) => option.value === mapping.kind)?.label}
                            </span>
                        </SelectTrigger>
                        <SelectContent side="bottom" align="start" sideOffset={4} container={menuContainer}>
                            {mappingKindOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <ArrowRight size={15} aria-hidden="true" />
                </div>
                <div className="transfer-node-mapping-target">
                    {targetField ? <FieldDetails field={targetField} side="target" /> : (
                        <div className="transfer-node-stale-target">
                            <div>
                                <strong>{mapping.target}</strong>
                                <span className="transfer-node-mapping-error">{targetLabel}已不存在</span>
                            </div>
                            <button
                                type="button"
                                aria-label={`移除 ${mapping.target} 失效映射`}
                                title="移除失效映射"
                                onClick={() => onRemove(mapping.target)}
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                    )}
                </div>
                </div>
            );
        })}
    </div>;
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
    dataSourceSearch,
    metadata,
    databaseUnavailable,
    onSelectDataSource,
    onSelectDatabase,
    onSelectTable,
    onPatch,
    writeModes,
    menuContainer,
}: EndpointFieldsProps) {
    const endpoint = config[side];
    const whereInputId = useId();
    const [whereExpanded, setWhereExpanded] = useState(false);
    const [whereTouched, setWhereTouched] = useState(false);
    const whereValue = config.source.where ?? '';
    const whereHasPrefix = /^\s*where\b/i.test(whereValue);
    const sideLabel = side === 'source' ? '来源' : '目标';
    const tableDisabled = !endpoint.dataSourceId
        || !endpoint.database
        || metadata.databases.loading
        || Boolean(metadata.databases.error)
        || metadata.tables.loading;
    const dataSourceOptions = useMemo(
        () => dataSources.map((dataSource) => ({
            value: String(dataSource.id),
            label: `${dataSource.name} (${dataSource.type})`,
        })),
        [dataSources],
    );
    const databaseOptions = useMemo(() => {
        const options = metadata.databases.data.map((database) => ({ value: database, label: database }));
        if (!databaseUnavailable || !endpoint.database) return options;
        return [
            { value: endpoint.database, label: `${endpoint.database}（不可用）` },
            ...options,
        ];
    }, [databaseUnavailable, endpoint.database, metadata.databases.data]);
    const tableOptions = useMemo(
        () => {
            const options = metadata.tables.data.map((table) => ({ value: table, label: table }));
            if (!endpoint.table || options.some((option) => option.value === endpoint.table)) return options;
            return [{ value: endpoint.table, label: endpoint.table }, ...options];
        },
        [endpoint.table, metadata.tables.data],
    );

    return (
        <section className="transfer-node-panel transfer-node-endpoint-panel">
            <h3>{title}</h3>
            <div className="transfer-node-connection-fields">
                <div className="transfer-node-control-group transfer-node-control-group--data-source">
                    <label className="transfer-node-field">
                        数据源
                        <TransferSearchSelect
                            ariaLabel="数据源"
                            value={endpoint.dataSourceId ? String(endpoint.dataSourceId) : ''}
                            options={dataSourceOptions}
                            placeholder="选择数据源"
                            loading={dataSourceSearch.loading}
                            loadingMore={dataSourceSearch.loadingMore}
                            hasMore={dataSourceSearch.hasMore}
                            menuContainer={menuContainer}
                            contentClassName="min-w-[280px] max-w-[calc(100vw-32px)]"
                            onChange={(nextValue) => onSelectDataSource(Number(nextValue))}
                            onSearch={dataSourceSearch.search}
                            onLoadMore={dataSourceSearch.loadMore}
                        />
                    </label>
                </div>
                <div className="transfer-node-control-group">
                    <label className="transfer-node-field">
                        数据库
                        <TransferSearchSelect
                            ariaLabel="数据库"
                            value={endpoint.database ?? ''}
                            options={databaseOptions}
                            placeholder="选择数据库"
                            disabled={!endpoint.dataSourceId || metadata.databases.loading}
                            loading={metadata.databases.loading}
                            menuContainer={menuContainer}
                            contentClassName="min-w-[180px] max-w-[calc(100vw-32px)]"
                            onChange={onSelectDatabase}
                        />
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
                </div>
                <div className="transfer-node-control-group">
                    <label className="transfer-node-field">
                        表
                        <TransferSearchSelect
                            ariaLabel="表"
                            value={endpoint.table}
                            options={tableOptions}
                            placeholder="选择表"
                            disabled={tableDisabled}
                            loading={metadata.tables.loading}
                            loadingMore={metadata.tables.loadingMore}
                            hasMore={metadata.tables.hasMore}
                            menuContainer={menuContainer}
                            contentClassName="min-w-[280px] max-w-[calc(100vw-32px)]"
                            onChange={onSelectTable}
                            onSearch={metadata.tables.search}
                            onLoadMore={metadata.tables.loadMore}
                        />
                    </label>
                    {metadata.tables.error && (
                        <ResourceError
                            message={`${sideLabel}${metadata.tables.error}`}
                            retryLabel={`重试${sideLabel}表`}
                            onRetry={metadata.tables.retry}
                        />
                    )}
                </div>
            </div>
            <div className={`transfer-node-secondary-fields transfer-node-secondary-fields--${side}`}>
                {side === 'source' ? (
                    <div className="transfer-node-field transfer-node-filter-field">
                        <label htmlFor={whereInputId}>过滤条件（可选）</label>
                        <div className={`transfer-node-filter-control${whereTouched && whereHasPrefix ? ' is-invalid' : ''}`}>
                            <span className="transfer-node-filter-prefix" aria-hidden="true">WHERE</span>
                            <textarea
                                id={whereInputId}
                                aria-label="过滤条件（可选）"
                                aria-invalid={whereTouched && whereHasPrefix}
                                rows={whereExpanded ? 3 : 1}
                                value={whereValue}
                                onBlur={() => setWhereTouched(true)}
                                onChange={(event) => onPatch({
                                    source: { ...config.source, where: event.target.value },
                                })}
                                placeholder="status = 'ACTIVE' AND created_at >= '2026-01-01'"
                            />
                            <button
                                type="button"
                                className="transfer-node-filter-expand"
                                aria-label={whereExpanded ? '收起过滤条件' : '展开过滤条件'}
                                title={whereExpanded ? '收起过滤条件' : '展开过滤条件'}
                                onClick={() => setWhereExpanded((current) => !current)}
                            >
                                {whereExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            </button>
                        </div>
                        {whereTouched && whereHasPrefix ? (
                            <span className="transfer-node-filter-error">无需填写 WHERE，请从字段条件开始。</span>
                        ) : (
                            <span className="transfer-node-field-help">只填写 WHERE 后面的条件，语法按来源数据库执行。</span>
                        )}
                    </div>
                ) : (
                    <label className="transfer-node-field">
                        写入方式
                        <Select
                            value={config.target.writeMode ?? 'append'}
                            disabled={!metadata.metadata.data || metadata.metadata.loading}
                            onValueChange={(nextMode) => {
                                if (!nextMode) return;
                                onPatch({
                                    target: {
                                        ...config.target,
                                        writeMode: nextMode as TransferWriteMode,
                                    },
                                });
                            }}
                        >
                            <SelectTrigger
                                aria-label="写入方式"
                                className="transfer-node-write-mode-trigger"
                            >
                                <span data-slot="select-value" className="flex flex-1 text-left">
                                    {writeModes.find((mode) => mode.value === config.target.writeMode)?.label
                                        ?? '加载目标表后可选择'}
                                </span>
                            </SelectTrigger>
                            <SelectContent
                                side="bottom"
                                align="start"
                                sideOffset={4}
                                container={menuContainer}
                            >
                                {writeModes.map((mode) => (
                                    <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                )}
            </div>
        </section>
    );
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
