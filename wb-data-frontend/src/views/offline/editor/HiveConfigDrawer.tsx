import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, RotateCcw, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
    HIVE_CONF_PRESETS,
    areHiveConfsEqual,
    normalizeHiveConfRecord,
    validateHiveConfEntry,
} from './hiveConf';

export interface HiveConfigDrawerProps {
    nodeKey: string;
    value?: Record<string, string>;
    readOnly?: boolean;
    onChange: (nextHiveConf: Record<string, string> | undefined) => void;
    onClose: () => void;
}

interface HiveConfRow {
    rowId: string;
    key: string;
    value: string;
}

interface EvaluatedRow {
    row: HiveConfRow;
    trimmedKey: string;
    error: string | null;
}

function recordToRows(conf: Record<string, string> | undefined, createRowId: () => string): HiveConfRow[] {
    const normalized = normalizeHiveConfRecord(conf);
    if (!normalized) {
        return [];
    }
    return Object.entries(normalized).map(([key, value]) => ({
        rowId: createRowId(),
        key,
        value,
    }));
}

function evaluateRows(rows: HiveConfRow[]): {
    evaluated: EvaluatedRow[];
    validConf: Record<string, string> | undefined;
    hasErrors: boolean;
} {
    const keyCounts = new Map<string, number>();
    for (const row of rows) {
        const trimmed = row.key.trim();
        if (trimmed) {
            keyCounts.set(trimmed, (keyCounts.get(trimmed) ?? 0) + 1);
        }
    }

    const emittedKeys = new Set<string>();
    const validRecord: Record<string, string> = {};
    let hasErrors = false;

    const evaluated = rows.map((row): EvaluatedRow => {
        const trimmedKey = row.key.trim();
        if (!trimmedKey && row.value === '') {
            return { row, trimmedKey, error: null };
        }
        if (!trimmedKey && row.value !== '') {
            hasErrors = true;
            return { row, trimmedKey, error: '请填写参数名' };
        }
        const formatError = validateHiveConfEntry(trimmedKey, row.value);
        if (formatError) {
            hasErrors = true;
            return { row, trimmedKey, error: formatError };
        }
        if ((keyCounts.get(trimmedKey) ?? 0) > 1) {
            hasErrors = true;
            return { row, trimmedKey, error: '参数名重复' };
        }
        if (!emittedKeys.has(trimmedKey)) {
            emittedKeys.add(trimmedKey);
            validRecord[trimmedKey] = row.value;
        }
        return { row, trimmedKey, error: null };
    });

    return {
        evaluated,
        validConf: Object.keys(validRecord).length > 0 ? validRecord : undefined,
        hasErrors,
    };
}

export function HiveConfigDrawer({
    nodeKey,
    value,
    readOnly = false,
    onChange,
    onClose,
}: HiveConfigDrawerProps) {
    const rowIdCounterRef = useRef(0);
    const nextRowId = () => {
        rowIdCounterRef.current += 1;
        return `hive-conf-row-${rowIdCounterRef.current}`;
    };

    const [presetsExpanded, setPresetsExpanded] = useState(false);
    const [rows, setRows] = useState<HiveConfRow[]>(() => recordToRows(value, nextRowId));
    const lastEmittedRef = useRef<Record<string, string> | undefined>(normalizeHiveConfRecord(value));
    const prevNodeKeyRef = useRef(nodeKey);

    useEffect(() => {
        const nodeChanged = prevNodeKeyRef.current !== nodeKey;
        const externalChanged = !areHiveConfsEqual(value, lastEmittedRef.current);
        if (nodeChanged || externalChanged) {
            prevNodeKeyRef.current = nodeKey;
            if (nodeChanged) {
                setPresetsExpanded(false);
            }
            const normalized = normalizeHiveConfRecord(value);
            lastEmittedRef.current = normalized;
            setRows(recordToRows(normalized, nextRowId));
        }
    }, [nodeKey, value]);

    const { evaluated, validConf, hasErrors } = useMemo(() => evaluateRows(rows), [rows]);

    const applyRows = (nextRows: HiveConfRow[]) => {
        setRows(nextRows);
        const { validConf: nextValid } = evaluateRows(nextRows);
        if (!areHiveConfsEqual(nextValid, lastEmittedRef.current)) {
            lastEmittedRef.current = nextValid;
            onChange(nextValid);
        }
    };

    const configuredKeySet = useMemo(
        () => new Set(evaluated.map((item) => item.trimmedKey).filter(Boolean)),
        [evaluated],
    );

    const activeCount = validConf ? Object.keys(validConf).length : 0;

    const handleAddEmptyRow = () => {
        if (readOnly) return;
        setRows((current) => [...current, { rowId: nextRowId(), key: '', value: '' }]);
    };

    const handleApplyPreset = (presetKey: string, presetValue: string) => {
        if (readOnly) return;
        const existingIndex = rows.findIndex((row) => row.key.trim() === presetKey);
        if (existingIndex >= 0) {
            return;
        }
        const emptyRowIndex = rows.findIndex((row) => !row.key.trim() && row.value === '');
        const nextRow: HiveConfRow = { rowId: nextRowId(), key: presetKey, value: presetValue };
        if (emptyRowIndex >= 0) {
            const nextRows = rows.map((row, idx) => (idx === emptyRowIndex ? nextRow : row));
            applyRows(nextRows);
            return;
        }
        applyRows([...rows, nextRow]);
    };

    const handleUpdateRow = (rowId: string, patch: Partial<Pick<HiveConfRow, 'key' | 'value'>>) => {
        if (readOnly) return;
        const nextRows = rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row));
        applyRows(nextRows);
    };

    const handleRemoveRow = (rowId: string) => {
        if (readOnly) return;
        const nextRows = rows.filter((row) => row.rowId !== rowId);
        applyRows(nextRows);
    };

    const handleClearAll = () => {
        if (readOnly) return;
        applyRows([]);
    };

    return (
        <aside
            className="offline-hive-drawer"
            aria-label="Hive 运行参数设置"
            data-testid="hive-conf-drawer"
        >
            <div className="offline-hive-drawer-header">
                <div className="offline-hive-drawer-title">
                    <SlidersHorizontal size={14} className="offline-hive-drawer-icon" aria-hidden="true" />
                    <span>Hive 运行参数</span>
                    {activeCount > 0 ? (
                        <span className="offline-hive-drawer-badge" data-testid="hive-conf-active-count">
                            {activeCount}
                        </span>
                    ) : null}
                </div>
                <div className="offline-hive-drawer-header-actions">
                    {!readOnly && rows.length > 0 ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="offline-hive-drawer-clear-btn"
                                    onClick={handleClearAll}
                                >
                                    <RotateCcw size={12} aria-hidden="true" />
                                    清空
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content z-[2100]" side="bottom" collisionPadding={12}>
                                清空全部 Hive 运行参数
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    <button
                        type="button"
                        className="offline-hive-drawer-close-btn"
                        onClick={onClose}
                        aria-label="收起 Hive 运行参数抽屉"
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                </div>
            </div>

            <div className="offline-hive-drawer-body">
                <div className="offline-hive-drawer-note">
                    配置会以 <code>--hiveconf</code> 传给 Beeline 会话，对当前节点所有语句生效；SQL 文本变量仍请使用{' '}
                    <code>^[参数名]</code>（参数组）。
                </div>

                {!readOnly ? (
                    <section className="offline-hive-drawer-section offline-hive-preset-section">
                        <button
                            type="button"
                            className={`offline-hive-preset-toggle ${presetsExpanded ? 'is-expanded' : ''}`}
                            aria-expanded={presetsExpanded}
                            aria-controls="offline-hive-preset-list"
                            data-testid="hive-conf-presets-toggle"
                            onClick={() => setPresetsExpanded((prev) => !prev)}
                        >
                            <span className="offline-hive-drawer-section-label">
                                <Sparkles size={12} aria-hidden="true" />
                                <span>常用参数快捷填入</span>
                            </span>
                            <span className="offline-hive-preset-toggle-meta">
                                <span className="offline-hive-preset-count">{HIVE_CONF_PRESETS.length} 项</span>
                                {presetsExpanded ? (
                                    <ChevronDown size={14} aria-hidden="true" />
                                ) : (
                                    <ChevronRight size={14} aria-hidden="true" />
                                )}
                            </span>
                        </button>
                        {presetsExpanded ? (
                            <div
                                id="offline-hive-preset-list"
                                className="offline-hive-preset-grid"
                                data-testid="hive-conf-preset-list"
                            >
                                {HIVE_CONF_PRESETS.map((preset) => {
                                    const added = configuredKeySet.has(preset.key);
                                    return (
                                        <Tooltip key={preset.key}>
                                            <TooltipTrigger asChild>
                                                <span className="block w-full">
                                                    <button
                                                        type="button"
                                                        className={`offline-hive-preset-chip ${added ? 'is-added' : ''}`}
                                                        disabled={added}
                                                        onClick={() => handleApplyPreset(preset.key, preset.value)}
                                                    >
                                                        <span className="offline-hive-preset-label">{preset.label}</span>
                                                        <code className="offline-hive-preset-kv">{preset.key}={preset.value}</code>
                                                    </button>
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent className="tooltip-content tooltip-content-wrap z-[2100]" side="left" collisionPadding={12}>
                                                {`${preset.key}=${preset.value} — ${preset.description}`}
                                            </TooltipContent>
                                        </Tooltip>
                                    );
                                })}
                            </div>
                        ) : null}
                    </section>
                ) : null}

                <section className="offline-hive-drawer-section offline-hive-drawer-kv-section">
                    <div className="offline-hive-drawer-section-head">
                        <span className="offline-hive-drawer-section-label">参数列表</span>
                        {!readOnly ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                className="offline-hive-add-btn"
                                onClick={handleAddEmptyRow}
                            >
                                <Plus size={12} aria-hidden="true" />
                                添加参数
                            </Button>
                        ) : null}
                    </div>

                    {!readOnly && hasErrors ? (
                        <div className="offline-hive-drawer-warning" role="status">
                            存在未完善或重复的参数项，修正后才会随节点保存或试跑生效。
                        </div>
                    ) : null}

                    {evaluated.length === 0 ? (
                        <div className="offline-hive-drawer-empty">
                            {readOnly
                                ? '当前线上版本未配置 Hive 运行参数。'
                                : '暂未配置自定义 Hive 运行参数，可展开上方“常用参数快捷填入”或点击“添加参数”。'}
                        </div>
                    ) : (
                        <div className="offline-hive-kv-list">
                            {evaluated.map(({ row, error }, index) => (
                                <div
                                    key={row.rowId}
                                    className={`offline-hive-kv-row ${!readOnly && error ? 'has-error' : ''}`}
                                >
                                    <div className="offline-hive-kv-inputs">
                                        <Input
                                            type="text"
                                            value={row.key}
                                            readOnly={readOnly}
                                            aria-label={`参数名 ${index + 1}`}
                                            placeholder="如 hive.exec.dynamic.partition.mode"
                                            className="offline-hive-kv-key"
                                            onChange={(event) => handleUpdateRow(row.rowId, { key: event.target.value })}
                                        />
                                        <div className="offline-hive-kv-value-wrap">
                                            <Input
                                                type="text"
                                                value={row.value}
                                                readOnly={readOnly}
                                                aria-label={`参数值 ${index + 1}`}
                                                placeholder="参数值"
                                                className="offline-hive-kv-val"
                                                onChange={(event) => handleUpdateRow(row.rowId, { value: event.target.value })}
                                            />
                                            {!readOnly ? (
                                                <button
                                                    type="button"
                                                    className="offline-hive-kv-remove"
                                                    aria-label={`删除参数 ${row.key.trim() || index + 1}`}
                                                    onClick={() => handleRemoveRow(row.rowId)}
                                                >
                                                    <Trash2 size={13} aria-hidden="true" />
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                    {!readOnly && error ? (
                                        <span className="offline-hive-kv-error" role="alert">{error}</span>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </aside>
    );
}
