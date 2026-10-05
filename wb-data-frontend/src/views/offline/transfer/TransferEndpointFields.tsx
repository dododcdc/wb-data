import { useId, useMemo, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

import type { DataSource } from '../../../api/datasource';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from '../../../components/ui/select';
import type { TransferEndpointMetadataState, TransferPagedResource } from './useTransferMetadata';
import { supportsTransferSql, type TransferConfig, type TransferWriteMode } from './transferTypes';
import { SqlStatements } from './TransferSqlStatements';
import { TransferSearchSelect } from './TransferSearchSelect';

export interface ResourceErrorProps {
    message: string;
    retryLabel: string;
    onRetry: () => void;
}

export function ResourceError({ message, retryLabel, onRetry }: ResourceErrorProps) {
    return (
        <div className="transfer-node-resource-error">
            <span>{message}</span>
            <button type="button" aria-label={retryLabel} onClick={onRetry}>重试</button>
        </div>
    );
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

export function EndpointFields({
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
                            <span className="transfer-node-field-help">{'只填写 WHERE 后面的条件，语法按来源数据库执行。支持 ^[参数名] 值占位符，不要加引号。'}</span>
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
            {side === 'target' && supportsTransferSql(endpoint.dataSourceType) && (
                <div className="transfer-node-target-sql">
                    <p className="transfer-node-field-help">
                        {'每项仅填写一条 SQL，可换行；按编号顺序执行。更换目标数据源、数据库或表会清空前后 SQL。支持参数组 ^[参数名] 值占位符，不要加引号；不支持动态数据库、表或字段名。'}
                    </p>
                    <SqlStatements
                        label="前置 SQL"
                        statements={endpoint.preSql}
                        help="传输前执行，前置 SQL 失败则不进行传输。"
                        onChange={(preSql) => onPatch({ target: { ...config.target, preSql } })}
                    />
                    <SqlStatements
                        label="后置 SQL"
                        statements={endpoint.postSql}
                        help="仅传输成功后执行。后置 SQL 失败会使节点失败，但不回滚已写入数据，请自行处理。"
                        onChange={(postSql) => onPatch({ target: { ...config.target, postSql } })}
                    />
                </div>
            )}
        </section>
    );
}
