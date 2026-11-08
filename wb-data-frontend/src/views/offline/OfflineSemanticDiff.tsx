import { useMemo, type ReactNode } from 'react';

import type { OfflineFlowVersionSnapshot } from '../../api/offline';
import { describeParameterDefinition } from './flowParameterDiff';
import { diffFlowVersions, hasNodeChanges, type DiffKind, type NodeVersionDiff } from './flowVersionDiff';

export type SemanticTab = 'overview' | 'nodes' | 'schedule' | 'dependencies' | 'parameters';

interface OfflineSemanticDiffProps {
    baseSnapshot: OfflineFlowVersionSnapshot;
    targetSnapshot: OfflineFlowVersionSnapshot;
    activeTab: SemanticTab;
    onTabChange: (tab: SemanticTab) => void;
    onOpenNode: (node: NodeVersionDiff) => void;
    rawActive: boolean;
    onOpenRaw: () => void;
}

export function OfflineSemanticDiff({ baseSnapshot, targetSnapshot, activeTab, onTabChange, onOpenNode, rawActive, onOpenRaw }: OfflineSemanticDiffProps) {
    const diff = useMemo(() => diffFlowVersions(baseSnapshot, targetSnapshot), [baseSnapshot, targetSnapshot]);
    const counts = {
        nodes: diff.summary.nodes,
        schedule: diff.summary.schedule,
        dependencies: diff.summary.dependencies,
        parameters: diff.summary.parameters,
    };

    return (
        <div className="offline-semantic-diff">
            <nav className="offline-semantic-tabs" aria-label="业务差异维度">
                <TabButton tab="overview" activeTab={activeTab} onChange={onTabChange}>概览</TabButton>
                <TabButton tab="nodes" activeTab={activeTab} onChange={onTabChange} count={counts.nodes}>节点</TabButton>
                <TabButton tab="schedule" activeTab={activeTab} onChange={onTabChange} count={counts.schedule}>调度</TabButton>
                <TabButton tab="dependencies" activeTab={activeTab} onChange={onTabChange} count={counts.dependencies}>依赖</TabButton>
                <TabButton tab="parameters" activeTab={activeTab} onChange={onTabChange} count={counts.parameters}>参数</TabButton>
                <button type="button" className={rawActive ? 'is-active' : ''} onClick={onOpenRaw}>原始文件</button>
            </nav>
            <div className="offline-semantic-content">
                {activeTab === 'overview' ? (
                    <div className="offline-semantic-overview">
                        {Object.entries(counts).map(([key, count]) => (
                            <button type="button" key={key} onClick={() => onTabChange(key as SemanticTab)}>
                                <strong>{count}</strong>
                                <span>{labelForTab(key)}</span>
                            </button>
                        ))}
                        <div className="offline-semantic-version-pair">
                            <span>{baseSnapshot.revision.slice(0, 12)}</span>
                            <span>{targetSnapshot.revision.slice(0, 12)}</span>
                        </div>
                    </div>
                ) : null}
                {activeTab === 'nodes' ? <NodesTab diff={diff.nodes} onOpenNode={onOpenNode} /> : null}
                {activeTab === 'schedule' ? <ScheduleTab fields={diff.schedule} /> : null}
                {activeTab === 'dependencies' ? <DependenciesTab diff={diff.dependencies} /> : null}
                {activeTab === 'parameters' ? <ParametersTab diff={diff.parameters} nodes={diff.nodes} onOpenNode={onOpenNode} /> : null}
            </div>
        </div>
    );
}

function TabButton({ tab, activeTab, onChange, count, children }: {
    tab: SemanticTab;
    activeTab: SemanticTab;
    onChange: (tab: SemanticTab) => void;
    count?: number;
    children: ReactNode;
}) {
    return (
        <button type="button" className={activeTab === tab ? 'is-active' : ''} onClick={() => onChange(tab)}>
            {children}{count !== undefined ? <small>{count}</small> : null}
        </button>
    );
}

function NodesTab({ diff, onOpenNode }: { diff: NodeVersionDiff[]; onOpenNode: (node: NodeVersionDiff) => void }) {
    const changed = diff.filter((node) => node.kind !== 'MODIFIED' || hasNodeChanges(node));
    if (!changed.length) return <EmptyDiff />;
    return (
        <div className="offline-semantic-list">
            {changed.map((node) => (
                <article key={node.taskId} className={`offline-semantic-node is-${node.kind.toLowerCase()}`}>
                    <div>
                        <strong>{node.taskId}</strong>
                        <span>{nodeKindLabel(node.kind)} · {reasonLabels(node).join(' / ') || '无变化'}</span>
                    </div>
                    <button type="button" onClick={() => onOpenNode(node)}>查看差异</button>
                </article>
            ))}
        </div>
    );
}

function reasonLabels(node: NodeVersionDiff) {
    const reasons: string[] = [];
    if (node.kind === 'ADDED') reasons.push('新增');
    if (node.kind === 'REMOVED') reasons.push('删除');
    if (node.contentChanged) reasons.push('内容');
    if (node.configChanged) reasons.push('配置');
    if (node.structureChanged) reasons.push('结构');
    if (node.upstreamChanged) reasons.push('上游');
    if (node.referencedParametersAdded.length || node.referencedParametersRemoved.length) reasons.push('引用参数');
    return reasons;
}

function ScheduleTab({ fields }: { fields: ReturnType<typeof diffFlowVersions>['schedule'] }) {
    if (!fields.length) return <EmptyDiff />;
    return (
        <table className="offline-semantic-table">
            <thead><tr><th>字段</th><th>旧版本</th><th>新版本</th></tr></thead>
            <tbody>
                {fields.map((field) => (
                    <tr key={field.field}>
                        <td>{scheduleFieldLabel(field.field)}</td>
                        <td>{formatValue(field.baseValue)}</td>
                        <td>{formatValue(field.targetValue)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function DependenciesTab({ diff }: { diff: ReturnType<typeof diffFlowVersions>['dependencies'] }) {
    if (!diff.items.length && !diff.fields.length) return <EmptyDiff />;
    return (
        <div className="offline-semantic-list">
            {diff.items.map((item) => (
                <article key={item.key} className={`is-${item.kind.toLowerCase()}`}>
                    <strong>{item.key}</strong>
                    <span>{nodeKindLabel(item.kind)}</span>
                </article>
            ))}
            {diff.fields.length ? (
                <table className="offline-semantic-table">
                    <thead><tr><th>策略</th><th>旧版本</th><th>新版本</th></tr></thead>
                    <tbody>
                        {diff.fields.map((field) => (
                            <tr key={field.field}>
                                <td>{field.field}</td>
                                <td>{formatValue(field.baseValue)}</td>
                                <td>{formatValue(field.targetValue)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : null}
        </div>
    );
}

function ParametersTab({ diff, nodes, onOpenNode }: {
    diff: ReturnType<typeof diffFlowVersions>['parameters'];
    nodes: NodeVersionDiff[];
    onOpenNode: (node: NodeVersionDiff) => void;
}) {
    if (!diff.groups.length && !diff.definitions.length) return <EmptyDiff />;
    return (
        <div className="offline-semantic-list">
            {diff.groups.map((group) => (
                <article key={group.key} className={`is-${group.kind.toLowerCase()}`}>
                    <strong>{group.targetName ?? group.baseName ?? group.key}</strong>
                    <span>{group.baseVersion ?? '—'} → {group.targetVersion ?? '—'}</span>
                </article>
            ))}
            {diff.definitions.length ? (
                <table className="offline-semantic-table">
                    <thead><tr><th>参数</th><th>旧版本</th><th>新版本</th><th>影响节点</th></tr></thead>
                    <tbody>
                        {diff.definitions.map((definition) => (
                            <tr key={definition.key}>
                                <td>{definition.key}</td>
                                <td>{definition.baseDefinition ? describeParameterDefinition(definition.baseDefinition) : '—'}</td>
                                <td>{definition.targetDefinition ? describeParameterDefinition(definition.targetDefinition) : '—'}</td>
                                <td>
                                    {definition.impactedTaskIds.length ? definition.impactedTaskIds.map((taskId) => {
                                        const node = nodes.find((candidate) => candidate.taskId === taskId);
                                        return node ? (
                                            <button type="button" className="offline-semantic-node-link" key={taskId} onClick={() => onOpenNode(node)}>
                                                {taskId}
                                            </button>
                                        ) : null;
                                    }) : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : null}
        </div>
    );
}

function EmptyDiff() {
    return <p className="offline-semantic-empty">该维度没有差异</p>;
}

function nodeKindLabel(kind: DiffKind) {
    if (kind === 'ADDED') return '新增';
    if (kind === 'REMOVED') return '删除';
    return '修改';
}

function scheduleFieldLabel(field: string) {
    const labels: Record<string, string> = {
        period: '调度频率',
        cron: 'Cron',
        timezone: '调度时区',
        enabled: '启用状态',
        runtimeTimezone: '运行时区',
    };
    return labels[field] ?? field;
}

function formatValue(value: string | number | boolean | null) {
    if (value === null || value === undefined || value === '') return '—';
    if (value === true) return '启用';
    if (value === false) return '停用';
    return String(value);
}

function labelForTab(key: string) {
    if (key === 'nodes') return '节点变化';
    if (key === 'schedule') return '调度字段';
    if (key === 'dependencies') return '依赖变化';
    return '参数变化';
}
