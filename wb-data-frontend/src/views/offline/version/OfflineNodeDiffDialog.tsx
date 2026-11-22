import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Columns2, Expand, Minimize2, Rows3, Space, WrapText } from 'lucide-react';
import type { OfflineFlowNodeKind } from '../../../api/offline';
import { Button } from '../../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '../../../components/ui/dialog';
import { getNodeChangeReasons, type NodeVersionDiff, type VersionSnapshotNode } from './flowVersionDiff';
import { diffHiveConfEntries, normalizeHiveConfRecord } from '../editor/hiveConf';
import { NodeKindIcon } from '../canvas/nodeKindIcons';
import { getOfflineNodeKindLabel } from '../canvas/offlineNodeKinds';
import { PierreCodeDiff } from './PierreCodeDiff';
import { computePierreDiffModel } from './pierreDiffModel';
import type { TransferConfig, TransferEndpointConfig, TransferFieldMapping } from '../transfer/transferTypes';
import {
    DIFF_KIND_LABELS,
    TRANSFER_ENDPOINT_FIELD_LABELS,
    TRANSFER_WRITE_MODE_HINTS,
    areTransferEndpointFieldsEqual,
    formatDataSourceDisplay,
} from './versionComparePresentation';
import './OfflineNodeDiffDialog.css';

interface OfflineNodeDiffDialogProps {
    open?: boolean;
    nodeDiff?: NodeVersionDiff | null;
    node?: NodeVersionDiff | null;
    baseLabel?: string;
    targetLabel?: string;
    changedNodes?: NodeVersionDiff[];
    dataSourceNames?: Record<number, string>;
    onSelectNode?: (node: NodeVersionDiff) => void;
    onOpenChange?: (open: boolean) => void;
    onClose?: () => void;
}

function useIsDarkTheme() {
    const [isDark, setIsDark] = useState(() => (
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ));

    useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
        const root = document.documentElement;
        const update = () => setIsDark(root.classList.contains('dark'));
        update();
        const observer = new MutationObserver(update);
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    return isDark;
}

export function OfflineNodeDiffDialog({
    open = true,
    nodeDiff,
    node,
    baseLabel = '基准版本',
    targetLabel = '对比版本',
    changedNodes = [],
    dataSourceNames,
    onSelectNode,
    onOpenChange,
    onClose,
}: OfflineNodeDiffDialogProps) {
    const isDark = useIsDarkTheme();
    const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
    const [ignoreTrimWhitespace, setIgnoreTrimWhitespace] = useState(true);
    const [expandUnchanged, setExpandUnchanged] = useState(false);
    const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('wrap');
    const activeNodeDiff = nodeDiff ?? node ?? null;
    const baseNode = activeNodeDiff?.baseNode ?? null;
    const targetNode = activeNodeDiff?.targetNode ?? null;
    const displayKind = (targetNode?.kind ?? baseNode?.kind ?? 'SHELL') as OfflineFlowNodeKind;
    const isTransfer = baseNode?.kind === 'TRANSFER' || targetNode?.kind === 'TRANSFER';
    const scriptFileName = activeNodeDiff
        ? (targetNode?.scriptPath ?? baseNode?.scriptPath ?? `${activeNodeDiff.taskId}.${displayKind === 'SHELL' ? 'sh' : 'sql'}`)
        : '';
    const scriptLanguage = displayKind === 'SHELL' ? 'zsh' : 'sql';

    const scriptDiffModel = useMemo(() => {
        if (!activeNodeDiff || isTransfer) return null;
        return computePierreDiffModel({
            fileName: scriptFileName,
            lang: scriptLanguage,
            oldContents: baseNode ? (baseNode.scriptContent ?? '') : null,
            newContents: targetNode ? (targetNode.scriptContent ?? '') : null,
            ignoreWhitespace: ignoreTrimWhitespace,
        });
    }, [activeNodeDiff, baseNode, ignoreTrimWhitespace, isTransfer, scriptFileName, scriptLanguage, targetNode]);

    if (!activeNodeDiff) return null;

    const reasons = getNodeChangeReasons(activeNodeDiff);

    const currentChangedIndex = changedNodes.findIndex((item) => item.taskId === activeNodeDiff.taskId);
    const canStep = changedNodes.length > 1 && Boolean(onSelectNode);
    const prevChangedNode = canStep
        ? changedNodes[currentChangedIndex > 0 ? currentChangedIndex - 1 : changedNodes.length - 1]
        : null;
    const nextChangedNode = canStep
        ? changedNodes[currentChangedIndex >= 0 && currentChangedIndex < changedNodes.length - 1 ? currentChangedIndex + 1 : 0]
        : null;

    const metadataRows = buildNodeMetadataRows(baseNode, targetNode, dataSourceNames);
    const baseHiveConf = normalizeHiveConfRecord(baseNode?.hiveConf) ?? {};
    const targetHiveConf = normalizeHiveConfRecord(targetNode?.hiveConf) ?? {};
    const hiveConfKeys = [...new Set([...Object.keys(baseHiveConf), ...Object.keys(targetHiveConf)])];
    const changedHiveConfCount = diffHiveConfEntries(baseNode?.hiveConf, targetNode?.hiveConf).length;

    return (
        <Dialog open={open} onOpenChange={(next) => {
            onOpenChange?.(next);
            if (!next) onClose?.();
        }}>
            <DialogContent className="offline-node-diff-dialog">
                <DialogHeader>
                    <div className="offline-node-diff-header-row">
                        <div className="offline-node-diff-title-group">
                            <DialogTitle>
                                <span className="offline-node-diff-kind-icon">
                                    <NodeKindIcon kind={displayKind} size={17} />
                                </span>
                                <span className="offline-node-diff-taskid">{activeNodeDiff.taskId}</span>
                                <span className={`offline-diff-kind-pill is-${activeNodeDiff.kind.toLowerCase()}`}>
                                    {DIFF_KIND_LABELS[activeNodeDiff.kind]}
                                </span>
                            </DialogTitle>
                            <DialogDescription>
                                {baseLabel} → {targetLabel}
                            </DialogDescription>
                        </div>

                        {canStep ? (
                            <div className="offline-node-diff-stepper" aria-label="切换变更节点">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    disabled={!prevChangedNode}
                                    onClick={() => prevChangedNode && onSelectNode?.(prevChangedNode)}
                                >
                                    <ChevronLeft size={14} aria-hidden="true" />
                                    上一个
                                </Button>
                                <span className="offline-node-diff-step-count">
                                    {currentChangedIndex >= 0 ? `${currentChangedIndex + 1} / ${changedNodes.length}` : `${changedNodes.length} 个变更`}
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    disabled={!nextChangedNode}
                                    onClick={() => nextChangedNode && onSelectNode?.(nextChangedNode)}
                                >
                                    下一个
                                    <ChevronRight size={14} aria-hidden="true" />
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    {reasons.length > 0 ? (
                        <div className="offline-node-diff-reason-bar">
                            {reasons.map((reason) => (
                                <span key={reason} className="offline-node-diff-reason-chip">{reason}</span>
                            ))}
                        </div>
                    ) : null}
                </DialogHeader>

                <div className="offline-node-diff-body">
                    <section className="offline-node-diff-meta-card">
                        <div className="offline-node-diff-table-wrap">
                            <table className="offline-node-diff-meta-table">
                                <thead>
                                    <tr>
                                        <th>属性项</th>
                                        <th>{baseLabel}</th>
                                        <th>{targetLabel}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {metadataRows.map((row) => (
                                        <tr key={row.label} className={row.changed ? 'is-modified' : ''}>
                                            <td className="offline-node-diff-label-cell">{row.label}</td>
                                            <td className={row.changed ? 'is-base-cell' : ''}>{row.baseValue}</td>
                                            <td className={row.changed ? 'is-target-cell' : ''}>{row.targetValue}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {activeNodeDiff.referencedParametersAdded.length > 0 || activeNodeDiff.referencedParametersRemoved.length > 0 ? (
                            <div className="offline-node-diff-params">
                                <span className="offline-node-diff-params-title">参数引用变化：</span>
                                {activeNodeDiff.referencedParametersAdded.map((key) => (
                                    <span key={`add:${key}`} className="offline-param-chip is-added">+{key}</span>
                                ))}
                                {activeNodeDiff.referencedParametersRemoved.map((key) => (
                                    <span key={`rem:${key}`} className="offline-param-chip is-removed">-{key}</span>
                                ))}
                            </div>
                        ) : null}
                    </section>

                    {hiveConfKeys.length > 0 ? (
                        <section className="offline-node-diff-meta-card">
                            <div className="offline-node-diff-hiveconf-head">
                                <span>Hive 运行参数</span>
                                <span className="offline-node-diff-hiveconf-count">
                                    {changedHiveConfCount > 0 ? `${changedHiveConfCount} 项变更` : `共 ${hiveConfKeys.length} 项（无变化）`}
                                </span>
                            </div>
                            <div className="offline-node-diff-table-wrap">
                                <table className="offline-node-diff-meta-table">
                                    <thead>
                                        <tr>
                                            <th>参数 Key</th>
                                            <th>{baseLabel}</th>
                                            <th>{targetLabel}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {hiveConfKeys.map((key) => {
                                            const hasBase = Object.prototype.hasOwnProperty.call(baseHiveConf, key);
                                            const hasTarget = Object.prototype.hasOwnProperty.call(targetHiveConf, key);
                                            const changed = !hasBase || !hasTarget || baseHiveConf[key] !== targetHiveConf[key];
                                            return (
                                                <tr key={key} className={changed ? 'is-modified' : ''}>
                                                    <td className="offline-node-diff-label-cell offline-node-diff-hiveconf-key">{key}</td>
                                                    <td className={changed && hasBase ? 'is-base-cell' : ''}>
                                                        {hasBase ? <code className="offline-node-diff-hiveconf-val">{baseHiveConf[key]}</code> : '—'}
                                                    </td>
                                                    <td className={changed && hasTarget ? 'is-target-cell' : ''}>
                                                        {hasTarget ? <code className="offline-node-diff-hiveconf-val">{targetHiveConf[key]}</code> : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    ) : null}

                    {isTransfer ? (
                        <TransferDiff
                            taskId={activeNodeDiff.taskId}
                            base={baseNode?.transfer ?? null}
                            target={targetNode?.transfer ?? null}
                            dataSourceNames={dataSourceNames}
                            isDark={isDark}
                        />
                    ) : scriptDiffModel ? (
                        <section className="offline-node-diff-editor-section">
                            <div className="offline-node-diff-editor-toolbar">
                                <div className="offline-node-diff-editor-heading">
                                    <span className="offline-node-diff-editor-title">
                                        脚本对比 ({displayKind === 'SHELL' ? 'Shell' : 'SQL'})
                                    </span>
                                    <code className="offline-node-diff-filename">{scriptFileName}</code>
                                    {scriptDiffModel.kind === 'diff' ? (
                                        <span className="offline-node-diff-stats" aria-label="代码行变更统计">
                                            <em className="is-added">+{scriptDiffModel.additions}</em>
                                            <em className="is-removed">-{scriptDiffModel.deletions}</em>
                                        </span>
                                    ) : null}
                                </div>
                                <div className="offline-node-diff-editor-controls">
                                    <div className="offline-diff-segmented" role="group" aria-label="代码对比视图">
                                        <button
                                            type="button"
                                            aria-pressed={diffStyle === 'split'}
                                            className={`offline-diff-seg-btn ${diffStyle === 'split' ? 'is-active' : ''}`}
                                            onClick={() => setDiffStyle('split')}
                                        >
                                            <Columns2 size={12} aria-hidden="true" />
                                            并排
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={diffStyle === 'unified'}
                                            className={`offline-diff-seg-btn ${diffStyle === 'unified' ? 'is-active' : ''}`}
                                            onClick={() => setDiffStyle('unified')}
                                        >
                                            <Rows3 size={12} aria-hidden="true" />
                                            内联
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        aria-pressed={expandUnchanged}
                                        className={`offline-editor-toggle-btn ${expandUnchanged ? 'is-active' : ''}`}
                                        onClick={() => setExpandUnchanged((v) => !v)}
                                    >
                                        {expandUnchanged ? <Minimize2 size={12} aria-hidden="true" /> : <Expand size={12} aria-hidden="true" />}
                                        {expandUnchanged ? '仅看变更块' : '展开全文'}
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={ignoreTrimWhitespace}
                                        className={`offline-editor-toggle-btn ${ignoreTrimWhitespace ? 'is-active' : ''}`}
                                        onClick={() => setIgnoreTrimWhitespace((v) => !v)}
                                    >
                                        <Space size={12} aria-hidden="true" />
                                        忽略首尾空白
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={overflow === 'wrap'}
                                        className={`offline-editor-toggle-btn ${overflow === 'wrap' ? 'is-active' : ''}`}
                                        onClick={() => setOverflow((v) => (v === 'wrap' ? 'scroll' : 'wrap'))}
                                    >
                                        <WrapText size={12} aria-hidden="true" />
                                        自动换行
                                    </button>
                                </div>
                            </div>
                            <PierreCodeDiff
                                model={scriptDiffModel}
                                diffStyle={diffStyle}
                                expandUnchanged={expandUnchanged}
                                overflow={overflow}
                                isDark={isDark}
                                onShowWhitespaceDiff={() => setIgnoreTrimWhitespace(false)}
                            />
                        </section>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function buildNodeMetadataRows(
    baseNode: VersionSnapshotNode | null,
    targetNode: VersionSnapshotNode | null,
    dataSourceNames?: Record<number, string>,
) {
    const baseKindText = baseNode?.kind ? getOfflineNodeKindLabel(baseNode.kind as OfflineFlowNodeKind) : '—';
    const targetKindText = targetNode?.kind ? getOfflineNodeKindLabel(targetNode.kind as OfflineFlowNodeKind) : '—';

    const baseDsText = baseNode ? formatDataSourceDisplay(baseNode.dataSourceId, baseNode.dataSourceType, dataSourceNames) : '—';
    const targetDsText = targetNode ? formatDataSourceDisplay(targetNode.dataSourceId, targetNode.dataSourceType, dataSourceNames) : '—';

    const baseStage = baseNode?.stageId ? `${baseNode.stageId}${baseNode.parallel ? ' (并行)' : ' (串行)'}` : '—';
    const targetStage = targetNode?.stageId ? `${targetNode.stageId}${targetNode.parallel ? ' (并行)' : ' (串行)'}` : '—';

    const basePath = baseNode?.scriptPath ?? '—';
    const targetPath = targetNode?.scriptPath ?? '—';

    return [
        {
            label: '节点类型',
            baseValue: baseKindText,
            targetValue: targetKindText,
            changed: (baseNode?.kind ?? null) !== (targetNode?.kind ?? null),
        },
        {
            label: '数据源',
            baseValue: baseDsText,
            targetValue: targetDsText,
            changed: (baseNode?.dataSourceId ?? null) !== (targetNode?.dataSourceId ?? null)
                || (baseNode?.dataSourceType ?? null) !== (targetNode?.dataSourceType ?? null),
        },
        {
            label: '执行阶段',
            baseValue: baseStage,
            targetValue: targetStage,
            changed: (baseNode?.stageId ?? null) !== (targetNode?.stageId ?? null)
                || (baseNode?.parallel ?? null) !== (targetNode?.parallel ?? null),
        },
        {
            label: '脚本路径',
            baseValue: basePath,
            targetValue: targetPath,
            changed: (baseNode?.scriptPath ?? null) !== (targetNode?.scriptPath ?? null),
        },
    ].filter((row) => row.baseValue !== '—' || row.targetValue !== '—');
}

const SOURCE_ENDPOINT_FIELDS = ['dataSourceId', 'dataSourceType', 'database', 'table', 'where'] as const;
const TARGET_ENDPOINT_FIELDS = ['dataSourceId', 'dataSourceType', 'database', 'table', 'writeMode', 'preSql', 'postSql'] as const;

function TransferDiff({
    taskId,
    base,
    target,
    dataSourceNames,
    isDark,
}: {
    taskId: string;
    base: TransferConfig | null;
    target: TransferConfig | null;
    dataSourceNames?: Record<number, string>;
    isDark: boolean;
}) {
    const [onlyChangedMappings, setOnlyChangedMappings] = useState(false);

    const jsonDiffModel = useMemo(() => computePierreDiffModel({
        fileName: `${taskId}.transfer.json`,
        lang: 'json',
        oldContents: base ? JSON.stringify(base, null, 2) : null,
        newContents: target ? JSON.stringify(target, null, 2) : null,
        ignoreWhitespace: false,
    }), [base, target, taskId]);

    const mappingRows = useMemo(() => {
        const baseMappings = new Map((base?.fieldMappings ?? []).map((entry) => [entry.target, entry]));
        const targetMappings = new Map((target?.fieldMappings ?? []).map((entry) => [entry.target, entry]));
        const targets = [...new Set([...baseMappings.keys(), ...targetMappings.keys()])];
        return targets.map((targetColumn) => {
            const left = baseMappings.get(targetColumn) ?? null;
            const right = targetMappings.get(targetColumn) ?? null;
            const leftText = formatFieldMapping(left);
            const rightText = formatFieldMapping(right);
            return {
                targetColumn,
                leftText,
                rightText,
                changed: leftText !== rightText,
                status: !left ? 'ADDED' : !right ? 'REMOVED' : leftText !== rightText ? 'MODIFIED' : 'UNCHANGED',
            };
        });
    }, [base?.fieldMappings, target?.fieldMappings]);

    const visibleMappingRows = onlyChangedMappings
        ? mappingRows.filter((row) => row.changed)
        : mappingRows;

    const hasPartitions = Boolean(base?.partitions?.length || target?.partitions?.length);

    return (
        <div className="offline-transfer-diff">
            <div className="offline-transfer-section-grid">
                <section className="offline-transfer-card">
                    <h4>源端</h4>
                    <TransferEndpointRows
                        fields={SOURCE_ENDPOINT_FIELDS}
                        baseEndpoint={base?.source}
                        targetEndpoint={target?.source}
                        dataSourceNames={dataSourceNames}
                    />
                </section>
                <section className="offline-transfer-card">
                    <h4>目标端</h4>
                    <TransferEndpointRows
                        fields={TARGET_ENDPOINT_FIELDS}
                        baseEndpoint={base?.target}
                        targetEndpoint={target?.target}
                        dataSourceNames={dataSourceNames}
                    />
                </section>
            </div>

            <section className="offline-transfer-card">
                <div className="offline-transfer-card-head">
                    <h4>
                        <span>字段映射</span>
                        <span className="offline-transfer-count-pill">({mappingRows.length})</span>
                    </h4>
                    <label className="offline-transfer-filter-check">
                        <input
                            type="checkbox"
                            checked={onlyChangedMappings}
                            onChange={(event) => setOnlyChangedMappings(event.target.checked)}
                        />
                        <span>仅看变更行</span>
                    </label>
                </div>

                {visibleMappingRows.length === 0 ? (
                    <p className="offline-transfer-empty-note">
                        {onlyChangedMappings ? '字段映射暂无差异' : '未配置字段映射'}
                    </p>
                ) : (
                    <div className="offline-transfer-mappings">
                        {visibleMappingRows.map((row) => (
                            <div key={row.targetColumn} className={`offline-transfer-mapping-row ${row.changed ? 'is-modified' : ''}`}>
                                <strong className="offline-transfer-mapping-col">{row.targetColumn}</strong>
                                <span className={row.status === 'REMOVED' || row.changed ? 'is-diff-base' : ''}>
                                    {row.leftText}
                                </span>
                                <span className="offline-transfer-mapping-arrow" aria-hidden="true">→</span>
                                <span className={row.status === 'ADDED' || row.changed ? 'is-diff-target' : ''}>
                                    {row.rightText}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {hasPartitions ? (
                <section className="offline-transfer-card">
                    <h4>分区配置</h4>
                    <div className="offline-transfer-mappings">
                        <div className="offline-transfer-mapping-row is-modified">
                            <strong>partitions</strong>
                            <span>{JSON.stringify(base?.partitions ?? [])}</span>
                            <span className="offline-transfer-mapping-arrow" aria-hidden="true">→</span>
                            <span>{JSON.stringify(target?.partitions ?? [])}</span>
                        </div>
                    </div>
                </section>
            ) : null}

            <details className="offline-transfer-raw-details">
                <summary>
                    <span>查看原始传输配置 JSON 对比</span>
                    {jsonDiffModel.kind === 'diff' ? (
                        <span className="offline-node-diff-stats">
                            <em className="is-added">+{jsonDiffModel.additions}</em>
                            <em className="is-removed">-{jsonDiffModel.deletions}</em>
                        </span>
                    ) : null}
                </summary>
                <div className="offline-node-diff-editor is-compact">
                    <PierreCodeDiff
                        model={jsonDiffModel}
                        diffStyle="split"
                        expandUnchanged={false}
                        overflow="wrap"
                        isDark={isDark}
                        compact
                    />
                </div>
            </details>
        </div>
    );
}

function TransferEndpointRows({
    fields,
    baseEndpoint,
    targetEndpoint,
    dataSourceNames,
}: {
    fields: readonly (keyof TransferEndpointConfig)[];
    baseEndpoint?: TransferEndpointConfig;
    targetEndpoint?: TransferEndpointConfig;
    dataSourceNames?: Record<number, string>;
}) {
    return (
        <div className="offline-transfer-endpoint-table">
            {fields.map((key) => {
                const leftRaw = baseEndpoint?.[key];
                const rightRaw = targetEndpoint?.[key];
                const changed = !areTransferEndpointFieldsEqual(key, leftRaw, rightRaw);
                return (
                    <div key={key} className={`offline-transfer-row ${changed ? 'is-modified' : ''}`}>
                        <span className="offline-transfer-field-label">
                            {TRANSFER_ENDPOINT_FIELD_LABELS[key] ?? key}
                        </span>
                        <div className="offline-transfer-field-val is-base">
                            {renderEndpointFieldValue(key, leftRaw, baseEndpoint?.dataSourceType, dataSourceNames)}
                        </div>
                        <div className="offline-transfer-field-val is-target">
                            {renderEndpointFieldValue(key, rightRaw, targetEndpoint?.dataSourceType, dataSourceNames)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function renderEndpointFieldValue(
    key: keyof TransferEndpointConfig,
    value: TransferEndpointConfig[keyof TransferEndpointConfig],
    dataSourceType: string | undefined,
    dataSourceNames?: Record<number, string>,
) {
    if (key === 'dataSourceId') {
        return <span>{formatDataSourceDisplay(value as number | undefined, dataSourceType, dataSourceNames)}</span>;
    }
    if (key === 'writeMode' && typeof value === 'string' && value.length > 0) {
        const hint = TRANSFER_WRITE_MODE_HINTS[value];
        return (
            <span className="offline-transfer-writemode">
                <code>{value}</code>
                {hint ? <span className="offline-transfer-writemode-hint">{hint}</span> : null}
            </span>
        );
    }
    if ((key === 'preSql' || key === 'postSql') && Array.isArray(value)) {
        if (value.length === 0) return <span className="offline-transfer-empty-val">—</span>;
        return (
            <ol className="offline-transfer-sql-list">
                {value.map((sql, idx) => (
                    <li key={idx}><code>{sql}</code></li>
                ))}
            </ol>
        );
    }
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
        return <span className="offline-transfer-empty-val">—</span>;
    }
    return <span>{String(value)}</span>;
}

function formatFieldMapping(mapping: TransferFieldMapping | null): string {
    if (!mapping) return '—';
    if (mapping.kind === 'source_field') {
        return `source_field: ${mapping.source ?? ''}`;
    }
    if (mapping.kind === 'source_expression') {
        return `source_expression: ${mapping.expression ?? ''}`;
    }
    return `static_value: ${mapping.value ?? ''}`;
}
