import { useEffect, useMemo, useRef, useState } from 'react';

import type { TransferConfig, TransferMappingKind, TransferPartitionMapping } from './transferTypes';
import { createDefaultFieldMappings, updateMapping } from './transferMapping';
import { validateTransferConfig } from './transferValidation';
import { useTransferMetadata } from './useTransferMetadata';
import './TransferNodeDialog.css';

interface TransferNodeDialogProps { groupId: number | null; value?: TransferConfig; onChange: (value: TransferConfig) => void; }
const emptyConfig: TransferConfig = { source: { dataSourceId: 0, dataSourceType: 'MYSQL', table: '' }, target: { dataSourceId: 0, dataSourceType: 'HIVE', table: '', writeMode: 'append' }, fieldMappings: [], partitions: [] };

function MappingRows({ mappings, onChange, sourceColumns }: { mappings: TransferConfig['fieldMappings']; sourceColumns: string[]; onChange: (mappings: TransferConfig['fieldMappings']) => void }) {
    return <>{mappings?.map((mapping) => {
        const value = mapping.source ?? mapping.value ?? mapping.expression ?? '';
        return <div className="transfer-node-mapping" key={mapping.target}><strong>{mapping.target}</strong><select value={mapping.kind} onChange={(event) => onChange(updateMapping(mappings, mapping.target, event.target.value as TransferMappingKind, value))}><option value="source_field">源字段</option><option value="static_value">静态值</option><option value="source_expression">源表达式</option></select>{mapping.kind === 'source_field' ? <select value={value} onChange={(event) => onChange(updateMapping(mappings, mapping.target, mapping.kind, event.target.value))}><option value="">选择字段</option>{sourceColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select> : <input value={value} onChange={(event) => onChange(updateMapping(mappings, mapping.target, mapping.kind, event.target.value))} placeholder={mapping.kind === 'static_value' ? '静态值' : '源端表达式'} />}</div>;
    })}</>;
}

export function TransferNodeDialog({ groupId, value, onChange }: TransferNodeDialogProps) {
    const [config, setConfig] = useState<TransferConfig>(value ?? emptyConfig);
    const emittedConfigRef = useRef('');
    const { dataSources, sourceTables, targetTables, sourceMetadata, targetMetadata } = useTransferMetadata(groupId, config.source.dataSourceId || undefined, config.source.database, config.source.table, config.target.dataSourceId || undefined, config.target.database, config.target.table);
    useEffect(() => {
        const next = JSON.stringify(value ?? emptyConfig);
        if (next !== emittedConfigRef.current) setConfig(value ?? emptyConfig);
    }, [value]);
    useEffect(() => {
        const next = JSON.stringify(config);
        if (next !== emittedConfigRef.current) {
            emittedConfigRef.current = next;
            onChange(config);
        }
    }, [config, onChange]);
    const sourceColumns = useMemo(() => sourceMetadata?.columns.map((column) => column.name) ?? [], [sourceMetadata]);
    const columns = targetMetadata?.columns.map((column) => column.name) ?? [];
    const partitions = targetMetadata?.partitionColumns.map((column) => column.name) ?? [];
    const validation = validateTransferConfig(config, columns, partitions);
    const patch = (next: Partial<TransferConfig>) => setConfig((current) => ({ ...current, ...next }));
    const selectEndpoint = (side: 'source' | 'target', id: number) => { const source = dataSources.find((item) => item.id === id); patch({ [side]: { ...config[side], dataSourceId: id, dataSourceType: (source?.type ?? 'MYSQL') as TransferConfig['source']['dataSourceType'], table: '' } }); };
    const selectTargetTable = (table: string) => patch({ target: { ...config.target, table } });
    useEffect(() => { if (!targetMetadata) return; const nextMappings = createDefaultFieldMappings(sourceColumns, targetMetadata.columns.map((column) => column.name)); const nextPartitions: TransferPartitionMapping[] = targetMetadata.partitionColumns.map((column) => ({ target: column.name, kind: 'source_field' })); setConfig((current) => ({ ...current, fieldMappings: current.fieldMappings?.length ? current.fieldMappings : nextMappings, partitions: current.partitions?.length ? current.partitions : nextPartitions, target: { ...current.target, writeMode: targetMetadata.writeModes.some((mode) => mode.value === current.target.writeMode) ? current.target.writeMode : targetMetadata.writeModes[0]?.value ?? 'append' } })); }, [targetMetadata, sourceColumns]);
    const writeModes = targetMetadata?.writeModes.filter((mode) => !(targetMetadata.partitioned && mode.value === 'overwrite_table')) ?? [];
    return (
        <div className="transfer-node-dialog" data-testid="transfer-node-dialog">
            <div className="transfer-node-grid">
                <section className="transfer-node-panel"><h3>来源</h3>
                    <label className="transfer-node-field">数据源<select value={config.source.dataSourceId || ''} onChange={(event) => selectEndpoint('source', Number(event.target.value))}><option value="">选择数据源</option>{dataSources.map((source) => <option key={source.id} value={source.id}>{source.name} ({source.type})</option>)}</select></label>
                    <label className="transfer-node-field">表<select value={config.source.table} onChange={(event) => patch({ source: { ...config.source, table: event.target.value } })}><option value="">选择表</option>{sourceTables.map((table) => <option key={table}>{table}</option>)}</select></label>
                    <label className="transfer-node-field">筛选条件（谓词片段）<input value={config.source.where ?? ''} onChange={(event) => patch({ source: { ...config.source, where: event.target.value } })} placeholder="status = 'ACTIVE'" /></label>
                </section>
                <section className="transfer-node-panel"><h3>目标</h3>
                    <label className="transfer-node-field">数据源<select value={config.target.dataSourceId || ''} onChange={(event) => selectEndpoint('target', Number(event.target.value))}><option value="">选择数据源</option>{dataSources.map((source) => <option key={source.id} value={source.id}>{source.name} ({source.type})</option>)}</select></label>
                    <label className="transfer-node-field">表<select value={config.target.table} onChange={(event) => selectTargetTable(event.target.value)}><option value="">选择表</option>{targetTables.map((table) => <option key={table}>{table}</option>)}</select></label>
                    <label className="transfer-node-field">写入方式<select value={config.target.writeMode ?? 'append'} onChange={(event) => patch({ target: { ...config.target, writeMode: event.target.value as TransferConfig['target']['writeMode'] } })}>{writeModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}{!writeModes.length && <option value="append">Append</option>}</select></label>
                </section>
            </div>
            <section className="transfer-node-panel"><h3>目标普通字段</h3><MappingRows mappings={config.fieldMappings} sourceColumns={sourceColumns} onChange={(fieldMappings) => patch({ fieldMappings })} /></section>
            {targetMetadata?.partitioned && <section className="transfer-node-panel"><h3>Hive 分区字段</h3><MappingRows mappings={config.partitions} sourceColumns={sourceColumns} onChange={(partitions) => patch({ partitions: partitions as TransferPartitionMapping[] })} /></section>}
            {validation.errors.length > 0 && <div className="transfer-node-errors">{validation.errors.map((error) => <div key={error}>{error}</div>)}</div>}
        </div>
    );
}
