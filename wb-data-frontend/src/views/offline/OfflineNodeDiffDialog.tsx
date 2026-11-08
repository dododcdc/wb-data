import { DiffEditor } from '@monaco-editor/react';

import type { OfflineFlowNode } from '../../api/offline';
import type { TransferFieldMapping, TransferPartitionMapping } from './transfer/transferTypes';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import type { NodeVersionDiff } from './flowVersionDiff';
import './OfflineNodeDiffDialog.css';

interface OfflineNodeDiffDialogProps {
    node: NodeVersionDiff;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type Mapping = TransferFieldMapping | TransferPartitionMapping;

export function OfflineNodeDiffDialog({ node, open, onOpenChange }: OfflineNodeDiffDialogProps) {
    const baseNode = node.baseNode;
    const targetNode = node.targetNode;
    const kind = targetNode?.kind ?? baseNode?.kind ?? 'SQL';
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent fullScreen className="offline-node-diff-dialog">
                <DialogHeader>
                    <DialogTitle>{node.taskId}</DialogTitle>
                    <DialogDescription>{kind} · {reasonText(node)}</DialogDescription>
                </DialogHeader>
                {baseNode?.kind && targetNode?.kind && baseNode.kind !== targetNode.kind ? (
                    <div className="offline-node-kind-banner">类型由 {baseNode.kind} 变为 {targetNode.kind}</div>
                ) : null}
                <NodeMetadata baseNode={baseNode} targetNode={targetNode} />
                {node.referencedParametersAdded.length || node.referencedParametersRemoved.length ? (
                    <div className="offline-node-parameter-changes">
                        {node.referencedParametersAdded.length ? <span>新增引用：{node.referencedParametersAdded.join(', ')}</span> : null}
                        {node.referencedParametersRemoved.length ? <span>移除引用：{node.referencedParametersRemoved.join(', ')}</span> : null}
                    </div>
                ) : null}
                {kind === 'TRANSFER' ? (
                    <TransferDiff baseNode={baseNode} targetNode={targetNode} />
                ) : (
                    <div className="offline-node-script-diff">
                        <DiffEditor
                            original={baseNode?.scriptContent ?? ''}
                            modified={targetNode?.scriptContent ?? ''}
                            language={kind === 'SHELL' ? 'shell' : 'sql'}
                            options={{ readOnly: true, originalEditable: false, renderSideBySide: true, wordWrap: 'on' }}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function NodeMetadata({ baseNode, targetNode }: { baseNode: OfflineFlowNode | null; targetNode: OfflineFlowNode | null }) {
    return (
        <table className="offline-node-meta-table">
            <thead><tr><th>配置</th><th>旧版本</th><th>新版本</th></tr></thead>
            <tbody>
                <tr>
                    <td>节点类型</td>
                    <td>{baseNode?.kind ?? '—'}</td>
                    <td>{targetNode?.kind ?? '—'}</td>
                </tr>
                <tr>
                    <td>数据源</td>
                    <td>{baseNode?.dataSourceId ?? '—'}</td>
                    <td>{targetNode?.dataSourceId ?? '—'}</td>
                </tr>
                <tr>
                    <td>数据源类型</td>
                    <td>{baseNode?.dataSourceType ?? '—'}</td>
                    <td>{targetNode?.dataSourceType ?? '—'}</td>
                </tr>
            </tbody>
        </table>
    );
}

function TransferDiff({ baseNode, targetNode }: { baseNode: OfflineFlowNode | null; targetNode: OfflineFlowNode | null }) {
    const baseTransfer = baseNode?.transfer ?? null;
    const targetTransfer = targetNode?.transfer ?? null;
    return (
        <div className="offline-transfer-diff">
            <EndpointDiff title="源端" baseEndpoint={baseTransfer?.source ?? null} targetEndpoint={targetTransfer?.source ?? null} />
            <EndpointDiff title="目标端" baseEndpoint={baseTransfer?.target ?? null} targetEndpoint={targetTransfer?.target ?? null} />
            <MappingDiff title="字段映射" baseMappings={baseTransfer?.fieldMappings ?? []} targetMappings={targetTransfer?.fieldMappings ?? []} />
            <MappingDiff title="分区映射" baseMappings={baseTransfer?.partitions ?? []} targetMappings={targetTransfer?.partitions ?? []} />
            <details className="offline-transfer-raw-json">
                <summary>原始 JSON</summary>
                <div>
                    <pre>{JSON.stringify(baseTransfer, null, 2)}</pre>
                    <pre>{JSON.stringify(targetTransfer, null, 2)}</pre>
                </div>
            </details>
        </div>
    );
}

function EndpointDiff({ title, baseEndpoint, targetEndpoint }: {
    title: string;
    baseEndpoint: NonNullable<OfflineFlowNode['transfer']>['source'] | null;
    targetEndpoint: NonNullable<OfflineFlowNode['transfer']>['target'] | null;
}) {
    const fields = ['dataSourceId', 'dataSourceType', 'database', 'table', 'where', 'writeMode', 'preSql', 'postSql'] as const;
    return (
        <section>
            <h3>{title}</h3>
            <table className="offline-semantic-table">
                <thead><tr><th>字段</th><th>旧版本</th><th>新版本</th></tr></thead>
                <tbody>
                    {fields.map((field) => (
                        <tr key={field} className={baseEndpoint?.[field] === targetEndpoint?.[field] ? '' : 'is-modified'}>
                            <td>{field}</td>
                            <td>{formatEndpointValue(baseEndpoint?.[field])}</td>
                            <td>{formatEndpointValue(targetEndpoint?.[field])}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}

function MappingDiff({ title, baseMappings, targetMappings }: { title: string; baseMappings: Mapping[]; targetMappings: Mapping[] }) {
    const baseByTarget = new Map(baseMappings.map((mapping) => [mapping.target, mapping]));
    const targetByTarget = new Map(targetMappings.map((mapping) => [mapping.target, mapping]));
    const targets = [...new Set([...baseByTarget.keys(), ...targetByTarget.keys()])].sort();
    if (!targets.length) return null;
    return (
        <section>
            <h3>{title}</h3>
            <table className="offline-semantic-table">
                <thead><tr><th>目标字段</th><th>旧版本</th><th>新版本</th></tr></thead>
                <tbody>
                    {targets.map((target) => {
                        const baseMapping = baseByTarget.get(target);
                        const targetMapping = targetByTarget.get(target);
                        const changed = JSON.stringify(baseMapping) !== JSON.stringify(targetMapping);
                        return (
                            <tr key={target} className={changed ? 'is-modified' : ''}>
                                <td>{target}</td>
                                <td>{formatMapping(baseMapping)}</td>
                                <td>{formatMapping(targetMapping)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </section>
    );
}

function formatEndpointValue(value: unknown) {
    if (value === undefined || value === null || value === '') return '—';
    return Array.isArray(value) ? value.join(' / ') : String(value);
}

function formatMapping(mapping: Mapping | undefined) {
    if (!mapping) return '—';
    return `${mapping.kind}: ${mapping.source ?? mapping.expression ?? mapping.value ?? '—'}`;
}

function reasonText(node: NodeVersionDiff) {
    const reasons: string[] = [];
    if (node.kind === 'ADDED') reasons.push('新增');
    if (node.kind === 'REMOVED') reasons.push('删除');
    if (node.contentChanged) reasons.push('内容');
    if (node.configChanged) reasons.push('配置');
    if (node.structureChanged) reasons.push('结构');
    if (node.upstreamChanged) reasons.push('上游');
    return reasons.join(' / ') || '无变化';
}
