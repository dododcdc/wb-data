import { useMemo, useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';

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
import { updateMapping } from './transferMapping';
import type {
    TransferFieldMapping,
    TransferMappingKind,
    TransferPartitionMapping,
} from './transferTypes';

export interface TransferSchemaField {
    name: string;
    type: string;
    remarks: string;
    size?: number;
    nullable?: boolean;
    primaryKey?: boolean;
    partition?: boolean;
}

const mappingKindOptions: Array<{ value: TransferMappingKind; label: string }> = [
    { value: 'source_field', label: '源字段' },
    { value: 'static_value', label: '固定值' },
    { value: 'source_expression', label: 'SQL 表达式' },
];

interface MappingRowsProps {
    mappings: Array<TransferFieldMapping | TransferPartitionMapping> | undefined;
    sourceFields: TransferSchemaField[];
    targetFields: TransferSchemaField[];
    targetLabel: '目标字段' | '分区字段';
    menuContainer?: HTMLElement | null;
    onChange: (mappings: Array<TransferFieldMapping | TransferPartitionMapping>) => void;
    onRemove: (target: string) => void;
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

export function MappingRows({
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
                                    ? '例如: 100、ACTIVE 或 ^[v_day]'
                                    : '例如: CONCAT(col, ^[suffix])'
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
