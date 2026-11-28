import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Code2, Copy, Database, FileCode2, GitCommitHorizontal, Terminal, TriangleAlert, X } from 'lucide-react';
import type { OfflineFlowNodeKind } from '../../api/offline';
import {
    getOperationsExecutionNodeSnapshot,
    type OperationsExecutionNodeSnapshot,
    type OperationsTransferMappingSnapshot,
} from '../../api/operations';
import { NodeKindIcon } from '../../components/execution/NodeKindIcon';
import {
    getOfflineNodeKindClassName,
    getOfflineNodeKindLabel,
    isOfflineFlowNodeKind,
} from '../../components/execution/offlineNodeKinds';
import './OperationsNodeSnapshotDialog.css';

interface OperationsNodeSnapshotDialogProps {
    open: boolean;
    groupId: number | null;
    executionId: string | null;
    taskId: string | null;
    onClose: () => void;
}

const WRITE_MODE_LABEL: Record<string, string> = {
    append: '追加写入 (append)',
    overwrite_table: '覆盖整表 (overwrite_table)',
    overwrite_partition: '覆盖分区 (overwrite_partition)',
};

const MAPPING_KIND_LABEL: Record<string, string> = {
    source_field: '源字段',
    source_expression: 'SQL 表达式',
    static_value: '静态值',
};

const PARAMETER_SOURCE_LABEL: Record<string, string> = {
    MANUAL_OVERRIDE: '手动覆盖',
    SYSTEM_TIME: '系统时间',
    EXPLICIT_INPUT: '外部传入',
    RERUN: '重跑沿用',
    CONSTANT: '固定值',
    UNAVAILABLE: '未知',
};

function resolveNodeKind(kind: string | null | undefined, dataSourceType?: string | null): OfflineFlowNodeKind {
    const normalized = kind?.trim().toUpperCase();
    if (normalized === 'SQL' && dataSourceType) {
        const normalizedDs = dataSourceType.trim().toUpperCase();
        if (isOfflineFlowNodeKind(normalizedDs)) return normalizedDs;
    }
    if (normalized && isOfflineFlowNodeKind(normalized)) {
        return normalized;
    }
    return 'SHELL';
}

function getKindDisplayLabel(kind: string | null | undefined, dataSourceType?: string | null) {
    return getOfflineNodeKindLabel(resolveNodeKind(kind, dataSourceType));
}

function renderMappingSourceDetail(mapping: OperationsTransferMappingSnapshot, useRendered: boolean) {
    if (mapping.kind === 'source_field') {
        return mapping.source || '—';
    }
    if (mapping.kind === 'source_expression') {
        return (useRendered && mapping.expressionRendered) || mapping.expressionRaw || '—';
    }
    if (mapping.kind === 'static_value') {
        return (useRendered && mapping.valueRendered != null ? mapping.valueRendered : mapping.valueRaw) ?? '—';
    }
    return mapping.source || mapping.expressionRaw || mapping.valueRaw || '—';
}

function CodeBlockWithLineNumbers({ code }: { code: string }) {
    const lines = useMemo(() => code.split(/\r?\n/), [code]);
    return (
        <div className="operations-snapshot-code-wrap">
            <div className="operations-snapshot-code-lines" aria-hidden="true">
                {lines.map((_, index) => (
                    <span key={index}>{index + 1}</span>
                ))}
            </div>
            <pre className="operations-snapshot-code-pre">
                <code>{code}</code>
            </pre>
        </div>
    );
}

function TransferSnapshotBody({
    snapshot,
    codeViewMode,
    onModeChange,
}: {
    snapshot: OperationsExecutionNodeSnapshot;
    codeViewMode: 'rendered' | 'raw';
    onModeChange: (mode: 'rendered' | 'raw') => void;
}) {
    const transfer = snapshot.transfer;
    if (!transfer) {
        return <div className="operations-snapshot-empty">暂无传输配置内容。</div>;
    }

    const hasParams = snapshot.referencedParameters.length > 0;
    const useRendered = codeViewMode === 'rendered' && !snapshot.renderError;
    const whereSql = useRendered ? (transfer.source?.whereRendered ?? transfer.source?.whereRaw) : transfer.source?.whereRaw;
    const preSqls = useRendered && transfer.preSqlRendered.length > 0 ? transfer.preSqlRendered : transfer.preSqlRaw;
    const postSqls = useRendered && transfer.postSqlRendered.length > 0 ? transfer.postSqlRendered : transfer.postSqlRaw;

    return (
        <div className="operations-snapshot-transfer">
            <div className="operations-snapshot-transfer-endpoints">
                <div className="operations-snapshot-endpoint-card">
                    <div className="operations-snapshot-endpoint-card__label">来源端 (Source)</div>
                    <div className="operations-snapshot-endpoint-card__title">
                        <Database size={14} aria-hidden="true" />
                        <span>{transfer.source?.dataSourceName || transfer.source?.dataSourceType || '未配置'}</span>
                        {transfer.source?.dataSourceType ? (
                            <span className="operations-snapshot-mini-pill">{transfer.source.dataSourceType}</span>
                        ) : null}
                    </div>
                    <div className="operations-snapshot-endpoint-card__table">
                        <code>
                            {[transfer.source?.database, transfer.source?.table].filter(Boolean).join('.') || '—'}
                        </code>
                    </div>
                </div>

                <div className="operations-snapshot-transfer-arrow" aria-hidden="true">
                    <ArrowRight size={16} />
                    {transfer.writeMode ? (
                        <span className="operations-snapshot-write-mode">
                            {WRITE_MODE_LABEL[transfer.writeMode] ?? transfer.writeMode}
                        </span>
                    ) : null}
                </div>

                <div className="operations-snapshot-endpoint-card">
                    <div className="operations-snapshot-endpoint-card__label">目标端 (Target)</div>
                    <div className="operations-snapshot-endpoint-card__title">
                        <Database size={14} aria-hidden="true" />
                        <span>{transfer.target?.dataSourceName || transfer.target?.dataSourceType || '未配置'}</span>
                        {transfer.target?.dataSourceType ? (
                            <span className="operations-snapshot-mini-pill">{transfer.target.dataSourceType}</span>
                        ) : null}
                    </div>
                    <div className="operations-snapshot-endpoint-card__table">
                        <code>
                            {[transfer.target?.database, transfer.target?.table].filter(Boolean).join('.') || '—'}
                        </code>
                    </div>
                </div>
            </div>

            {hasParams ? (
                <div className="operations-snapshot-transfer-mode-bar">
                    <div className="operations-snapshot-segmented" role="tablist" aria-label="参数展示模式">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={codeViewMode === 'rendered'}
                            className={`operations-snapshot-segmented__btn${codeViewMode === 'rendered' ? ' is-active' : ''}`}
                            onClick={() => onModeChange('rendered')}
                        >
                            渲染后参数值
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={codeViewMode === 'raw'}
                            className={`operations-snapshot-segmented__btn${codeViewMode === 'raw' ? ' is-active' : ''}`}
                            onClick={() => onModeChange('raw')}
                        >
                            原始模板
                        </button>
                    </div>
                    {snapshot.renderNote && useRendered ? (
                        <span className="operations-snapshot-render-note">{snapshot.renderNote}</span>
                    ) : null}
                </div>
            ) : null}

            {whereSql ? (
                <section className="operations-snapshot-section">
                    <h3 className="operations-snapshot-section__title">过滤条件 (WHERE)</h3>
                    <pre className="operations-snapshot-inline-sql"><code>{whereSql}</code></pre>
                </section>
            ) : null}

            {transfer.partitions.length > 0 ? (
                <section className="operations-snapshot-section">
                    <h3 className="operations-snapshot-section__title">分区映射 ({transfer.partitions.length})</h3>
                    <div className="operations-snapshot-table-wrap">
                        <table className="operations-snapshot-table">
                            <thead>
                                <tr>
                                    <th>目标分区字段</th>
                                    <th>来源类型</th>
                                    <th>取值 / 表达式</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transfer.partitions.map((item) => (
                                    <tr key={item.target}>
                                        <td><code>{item.target}</code></td>
                                        <td>{MAPPING_KIND_LABEL[item.kind ?? ''] ?? item.kind ?? '—'}</td>
                                        <td><code>{renderMappingSourceDetail(item, useRendered)}</code></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}

            <section className="operations-snapshot-section">
                <h3 className="operations-snapshot-section__title">字段映射 ({transfer.fieldMappings.length})</h3>
                {transfer.fieldMappings.length === 0 ? (
                    <div className="operations-snapshot-empty-inline">未配置字段映射。</div>
                ) : (
                    <div className="operations-snapshot-table-wrap">
                        <table className="operations-snapshot-table">
                            <thead>
                                <tr>
                                    <th>目标字段</th>
                                    <th>映射类型</th>
                                    <th>源字段 / 表达式 / 静态值</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transfer.fieldMappings.map((item) => (
                                    <tr key={item.target}>
                                        <td><code>{item.target}</code></td>
                                        <td>{MAPPING_KIND_LABEL[item.kind ?? ''] ?? item.kind ?? '—'}</td>
                                        <td><code>{renderMappingSourceDetail(item, useRendered)}</code></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {preSqls.length > 0 ? (
                <section className="operations-snapshot-section">
                    <h3 className="operations-snapshot-section__title">目标前置 SQL ({preSqls.length})</h3>
                    <div className="operations-snapshot-sql-list">
                        {preSqls.map((stmt, index) => (
                            <pre key={index} className="operations-snapshot-inline-sql"><code>{stmt}</code></pre>
                        ))}
                    </div>
                </section>
            ) : null}

            {postSqls.length > 0 ? (
                <section className="operations-snapshot-section">
                    <h3 className="operations-snapshot-section__title">目标后置 SQL ({postSqls.length})</h3>
                    <div className="operations-snapshot-sql-list">
                        {postSqls.map((stmt, index) => (
                            <pre key={index} className="operations-snapshot-inline-sql"><code>{stmt}</code></pre>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    );
}

export function OperationsNodeSnapshotDialog({
    open,
    groupId,
    executionId,
    taskId,
    onClose,
}: OperationsNodeSnapshotDialogProps) {
    const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setViewMode('rendered');
        setCopied(false);
    }, [executionId, taskId, open]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [onClose, open]);

    const snapshotQuery = useQuery({
        queryKey: ['operations-execution-node-snapshot', groupId, executionId, taskId],
        enabled: open && groupId != null && Boolean(executionId) && Boolean(taskId),
        queryFn: () => getOperationsExecutionNodeSnapshot(groupId!, executionId!, taskId!),
    });

    if (!open || !taskId) {
        return null;
    }

    const snapshot = snapshotQuery.data ?? null;
    const isTransfer = snapshot?.kind?.toUpperCase() === 'TRANSFER';
    const isShell = snapshot?.kind?.toUpperCase() === 'SHELL';
    const hasParameters = Boolean(snapshot && snapshot.referencedParameters.length > 0);
    const showModeTabs = Boolean(
        snapshot
        && !isTransfer
        && snapshot.contentAvailable
        && (hasParameters || Boolean(snapshot.renderError) || (snapshot.renderedContent != null && snapshot.renderedContent !== snapshot.rawContent)),
    );
    const effectiveMode: 'rendered' | 'raw' = snapshot?.renderedContent != null && viewMode === 'rendered'
        ? 'rendered'
        : 'raw';
    const displayedCode = snapshot
        ? (effectiveMode === 'rendered' ? (snapshot.renderedContent ?? snapshot.rawContent ?? '') : (snapshot.rawContent ?? ''))
        : '';

    const handleCopy = async () => {
        if (!displayedCode) return;
        try {
            await navigator.clipboard.writeText(displayedCode);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            // Clipboard unavailable in restricted context
        }
    };

    const resolvedKind = snapshot ? resolveNodeKind(snapshot.kind, snapshot.dataSourceType) : 'SHELL';
    const kindClass = snapshot ? getOfflineNodeKindClassName(resolvedKind) : 'shell';
    const kindLabel = snapshot ? getKindDisplayLabel(snapshot.kind, snapshot.dataSourceType) : '节点';

    return (
        <div
            className="operations-snapshot-overlay"
            onClick={onClose}
            role="presentation"
        >
            <aside
                className="operations-snapshot-drawer"
                role="dialog"
                aria-modal="true"
                aria-label={`${taskId} 节点执行快照`}
                onClick={(event) => event.stopPropagation()}
            >
                <header className="operations-snapshot-header">
                    <div className="operations-snapshot-header__left">
                        <div className="operations-snapshot-title-row">
                            {snapshot ? (
                                <span className={`operations-snapshot-kind-badge is-${kindClass}`} title={kindLabel}>
                                    <NodeKindIcon kind={resolvedKind} size={14} decorative />
                                    <span>{kindLabel}</span>
                                </span>
                            ) : (
                                <Code2 size={16} aria-hidden="true" />
                            )}
                            <h2 title={taskId}>{taskId}</h2>
                            {snapshot?.dataSourceName ? (
                                <span className="operations-snapshot-ds-pill" title={snapshot.dataSourceName}>
                                    <Database size={12} aria-hidden="true" />
                                    {snapshot.dataSourceName}
                                </span>
                            ) : null}
                        </div>
                        {snapshot ? (
                            <div className="operations-snapshot-meta">
                                {snapshot.exactSnapshot ? (
                                    <span className="operations-snapshot-provenance is-exact">
                                        <GitCommitHorizontal size={12} aria-hidden="true" />
                                        执行时快照
                                        {snapshot.snapshotCommitSha ? (
                                            <code>{snapshot.snapshotCommitSha.slice(0, 7)}</code>
                                        ) : null}
                                    </span>
                                ) : snapshot.snapshotSource === 'CURRENT_ONLINE' ? (
                                    <span className="operations-snapshot-provenance is-fallback">
                                        <TriangleAlert size={12} aria-hidden="true" />
                                        当前线上版本
                                    </span>
                                ) : null}
                                {snapshot.scriptPath ? (
                                    <span className="operations-snapshot-file-path" title={snapshot.scriptPath}>
                                        <FileCode2 size={12} aria-hidden="true" />
                                        <code>{snapshot.scriptPath}</code>
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        className="operations-execution-icon-button"
                        onClick={onClose}
                        aria-label="关闭节点快照"
                    >
                        <X size={15} />
                    </button>
                </header>

                <div className="operations-snapshot-body">
                    {snapshotQuery.isLoading ? (
                        <div className="operations-snapshot-loading" role="status">
                            <span>正在加载执行时快照…</span>
                        </div>
                    ) : snapshotQuery.isError ? (
                        <div className="operations-snapshot-error" role="alert">
                            <span>加载节点快照失败。</span>
                            <button type="button" onClick={() => void snapshotQuery.refetch()}>重试</button>
                        </div>
                    ) : !snapshot ? null : (
                        <>
                            {snapshot.snapshotNotice ? (
                                <div className="operations-snapshot-notice is-warning" role="status">
                                    <TriangleAlert size={15} className="shrink-0" aria-hidden="true" />
                                    <span>{snapshot.snapshotNotice}</span>
                                </div>
                            ) : null}

                            {snapshot.renderError ? (
                                <div className="operations-snapshot-notice is-error" role="alert">
                                    <TriangleAlert size={15} className="shrink-0" aria-hidden="true" />
                                    <span>参数代入失败（以下仍可查看原始模板）：{snapshot.renderError}</span>
                                </div>
                            ) : null}

                            {!snapshot.contentAvailable ? (
                                <div className="operations-snapshot-empty">
                                    {snapshot.snapshotNotice || '暂无节点脚本或配置内容。'}
                                </div>
                            ) : isTransfer ? (
                                <TransferSnapshotBody
                                    snapshot={snapshot}
                                    codeViewMode={effectiveMode}
                                    onModeChange={setViewMode}
                                />
                            ) : (
                                <div className="operations-snapshot-code-panel">
                                    <div className="operations-snapshot-code-toolbar">
                                        <div className="operations-snapshot-code-toolbar__left">
                                            {showModeTabs ? (
                                                <div className="operations-snapshot-segmented" role="tablist" aria-label="脚本展示模式">
                                                    <button
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={effectiveMode === 'rendered'}
                                                        disabled={snapshot.renderedContent == null}
                                                        className={`operations-snapshot-segmented__btn${effectiveMode === 'rendered' ? ' is-active' : ''}`}
                                                        onClick={() => setViewMode('rendered')}
                                                    >
                                                        {isShell ? '渲染后脚本' : '渲染后 SQL'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={effectiveMode === 'raw'}
                                                        className={`operations-snapshot-segmented__btn${effectiveMode === 'raw' ? ' is-active' : ''}`}
                                                        onClick={() => setViewMode('raw')}
                                                    >
                                                        {isShell ? '脚本模板' : 'SQL 模板'}
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="operations-snapshot-single-label">
                                                    <Terminal size={13} aria-hidden="true" />
                                                    {isShell ? '执行脚本' : '执行 SQL'}
                                                </span>
                                            )}
                                            {effectiveMode === 'rendered' && snapshot.renderNote ? (
                                                <span className="operations-snapshot-render-note">{snapshot.renderNote}</span>
                                            ) : null}
                                        </div>

                                        <button
                                            type="button"
                                            className="operations-snapshot-copy-btn"
                                            onClick={() => void handleCopy()}
                                            disabled={!displayedCode}
                                        >
                                            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                                            {copied ? '已复制' : '复制'}
                                        </button>
                                    </div>

                                    <CodeBlockWithLineNumbers code={displayedCode} />
                                </div>
                            )}

                            {snapshot.referencedParameters.length > 0 ? (
                                <section className="operations-snapshot-section">
                                    <h3 className="operations-snapshot-section__title">
                                        本次引用参数 ({snapshot.referencedParameters.length})
                                    </h3>
                                    <div className="operations-snapshot-table-wrap">
                                        <table className="operations-snapshot-table">
                                            <thead>
                                                <tr>
                                                    <th>参数名</th>
                                                    <th>本次运行值</th>
                                                    <th>来源</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {snapshot.referencedParameters.map((param) => (
                                                    <tr key={param.key}>
                                                        <td><code>{param.key}</code></td>
                                                        <td><code>{param.value ?? '—'}</code></td>
                                                        <td>{PARAMETER_SOURCE_LABEL[param.source] ?? param.source}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            ) : null}
                        </>
                    )}
                </div>
            </aside>
        </div>
    );
}
