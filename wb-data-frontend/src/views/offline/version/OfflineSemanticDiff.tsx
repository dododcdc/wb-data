import {
    ArrowRight,
    CheckCircle2,
    Crosshair,
    FileDiff,
    GitFork,
    SlidersHorizontal,
    Variable,
} from 'lucide-react';
import type { OfflineFlowVersionSnapshot } from '../../../api/offline';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { describeParameterDefinition } from './flowParameterDiff';
import {
    countTotalSemanticChanges,
    getNodeChangeReasons,
    hasNodeChanges,
    type FlowVersionDiff,
    type NodeVersionDiff,
} from './flowVersionDiff';
import { OfflineCompareCanvas } from './OfflineCompareCanvas';
import type { VersionSelection } from './OfflineVersionCompareDialog';
import { getOfflineNodeKindClassName, getOfflineNodeKindLabel } from '../canvas/offlineNodeKinds';
import {
    DEPENDENCY_FIELD_LABELS,
    DIFF_KIND_LABELS,
    SCHEDULE_FIELD_LABELS,
    formatDependencyFieldValue,
    formatRevisionTag,
    formatScheduleFieldValue,
    formatVersionShortLabel,
    formatVersionTooltipSummary,
    isDevelopmentVersion,
} from './versionComparePresentation';
import { VersionHoverTooltip } from './VersionHoverTooltip';
import './OfflineSemanticDiff.css';

export type SemanticTab = 'overview' | 'nodes' | 'schedule' | 'dependencies' | 'parameters';

interface OfflineSemanticDiffProps {
    base: VersionSelection;
    target: VersionSelection;
    baseSnapshot: OfflineFlowVersionSnapshot;
    targetSnapshot: OfflineFlowVersionSnapshot;
    diff: FlowVersionDiff;
    activeTab: SemanticTab;
    dataSourceNames?: Record<number, string>;
    focusNodeRequest?: { taskId: string; seq: number } | null;
    onChangeTab?: (tab: SemanticTab) => void;
    onSelectNode: (nodeDiff: NodeVersionDiff) => void;
    onFocusNodeOnCanvas?: (taskId: string) => void;
}

export function OfflineSemanticDiff({
    base,
    target,
    baseSnapshot,
    targetSnapshot,
    diff,
    activeTab,
    dataSourceNames,
    focusNodeRequest,
    onChangeTab,
    onSelectNode,
    onFocusNodeOnCanvas,
}: OfflineSemanticDiffProps) {
    if (activeTab === 'nodes') {
        return (
            <OfflineCompareCanvas
                base={base}
                target={target}
                baseSnapshot={baseSnapshot}
                targetSnapshot={targetSnapshot}
                diff={diff}
                dataSourceNames={dataSourceNames}
                focusNodeRequest={focusNodeRequest}
                onSelectNode={onSelectNode}
            />
        );
    }

    if (activeTab === 'overview') {
        const changedNodes = diff.nodes.filter(hasNodeChanges);
        const addedNodes = changedNodes.filter((n) => n.kind === 'ADDED').length;
        const modifiedNodes = changedNodes.filter((n) => n.kind === 'MODIFIED').length;
        const removedNodes = changedNodes.filter((n) => n.kind === 'REMOVED').length;
        const totalChanges = countTotalSemanticChanges(diff);

        const baseNodeCount = countNodes(baseSnapshot);
        const targetNodeCount = countNodes(targetSnapshot);
        const baseEdgeCount = baseSnapshot.document.edges?.length ?? 0;
        const targetEdgeCount = targetSnapshot.document.edges?.length ?? 0;

        return (
            <div className="offline-semantic-panel">
                {totalChanges === 0 ? (
                    <div className="offline-semantic-clean-banner" role="status">
                        <CheckCircle2 size={18} aria-hidden="true" />
                        <div>
                            <strong>两个版本在节点、连线、调度、依赖与参数配置上完全一致</strong>
                            <p>可通过顶部“交换方向”对比另一方向，或在“节点”页查看只读画布拓扑。</p>
                        </div>
                    </div>
                ) : null}

                <div className="offline-semantic-metrics">
                    <button
                        type="button"
                        className="offline-semantic-metric is-interactive"
                        onClick={() => onChangeTab?.('nodes')}
                    >
                        <span className="offline-semantic-metric-label">节点变更</span>
                        <strong className="offline-semantic-metric-value">{diff.summary.nodes}</strong>
                        <span className="offline-semantic-metric-breakdown">
                            <em className="is-added">+{addedNodes}</em>
                            <em className="is-modified">~{modifiedNodes}</em>
                            <em className="is-removed">-{removedNodes}</em>
                        </span>
                    </button>

                    <button
                        type="button"
                        className="offline-semantic-metric is-interactive"
                        onClick={() => onChangeTab?.('nodes')}
                    >
                        <span className="offline-semantic-metric-label">连线变更</span>
                        <strong className="offline-semantic-metric-value">{diff.edges.length}</strong>
                        <span className="offline-semantic-metric-sub">
                            {baseEdgeCount} → {targetEdgeCount} 条连线
                        </span>
                    </button>

                    <button
                        type="button"
                        className="offline-semantic-metric is-interactive"
                        onClick={() => onChangeTab?.('schedule')}
                    >
                        <span className="offline-semantic-metric-label">调度设置</span>
                        <strong className="offline-semantic-metric-value">{diff.summary.schedule}</strong>
                        <span className="offline-semantic-metric-sub">周期 / Cron / 时区</span>
                    </button>

                    <button
                        type="button"
                        className="offline-semantic-metric is-interactive"
                        onClick={() => onChangeTab?.('dependencies')}
                    >
                        <span className="offline-semantic-metric-label">上游依赖</span>
                        <strong className="offline-semantic-metric-value">{diff.summary.dependencies}</strong>
                        <span className="offline-semantic-metric-sub">上游任务与策略</span>
                    </button>

                    <button
                        type="button"
                        className="offline-semantic-metric is-interactive"
                        onClick={() => onChangeTab?.('parameters')}
                    >
                        <span className="offline-semantic-metric-label">绑定参数</span>
                        <strong className="offline-semantic-metric-value">{diff.summary.parameters}</strong>
                        <span className="offline-semantic-metric-sub">参数组与参数定义</span>
                    </button>
                </div>

                <div className="offline-semantic-version-grid">
                    <SnapshotSummaryCard
                        roleLabel="基准版本"
                        tone="base"
                        version={base}
                        nodeCount={baseNodeCount}
                        edgeCount={baseEdgeCount}
                        schedulePeriod={baseSnapshot.document.schedule?.period ?? null}
                    />
                    <SnapshotSummaryCard
                        roleLabel="对比版本"
                        tone="target"
                        version={target}
                        nodeCount={targetNodeCount}
                        edgeCount={targetEdgeCount}
                        schedulePeriod={targetSnapshot.document.schedule?.period ?? null}
                    />
                </div>

                {changedNodes.length > 0 ? (
                    <section className="offline-semantic-section-card">
                        <div className="offline-semantic-section-head">
                            <div>
                                <h3>变更节点速览 ({changedNodes.length})</h3>
                                <p>点击任意节点直接打开脚本或传输配置对比，或定位到双栏对比画布</p>
                            </div>
                            <button
                                type="button"
                                className="offline-semantic-link-btn"
                                onClick={() => onChangeTab?.('nodes')}
                            >
                                进入画布对比
                                <ArrowRight size={13} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="offline-semantic-node-list">
                            {changedNodes.map((node) => {
                                const displayNode = node.targetNode ?? node.baseNode;
                                const reasons = getNodeChangeReasons(node);
                                return (
                                    <div key={node.taskId} className={`offline-semantic-node-item is-${node.kind.toLowerCase()}`}>
                                        <button
                                            type="button"
                                            className="offline-semantic-node-main"
                                            onClick={() => onSelectNode(node)}
                                        >
                                            <span className={`offline-diff-kind-pill is-${node.kind.toLowerCase()}`}>
                                                {DIFF_KIND_LABELS[node.kind]}
                                            </span>
                                            <span className="offline-semantic-node-name">{node.taskId}</span>
                                            {displayNode?.kind ? (
                                                <span className={`offline-semantic-kind-tag ${getOfflineNodeKindClassName(displayNode.kind)}`}>
                                                    {getOfflineNodeKindLabel(displayNode.kind)}
                                                </span>
                                            ) : null}
                                            <span className="offline-semantic-reason-list">
                                                {reasons.map((reason) => (
                                                    <span key={reason} className="offline-semantic-reason-chip">{reason}</span>
                                                ))}
                                            </span>
                                        </button>
                                        {onFocusNodeOnCanvas ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="offline-semantic-focus-btn"
                                                        onClick={() => onFocusNodeOnCanvas(node.taskId)}
                                                    >
                                                        <Crosshair size={13} aria-hidden="true" />
                                                        定位画布
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent className="tooltip-content tooltip-content-wrap z-[2400]" side="left" collisionPadding={12}>
                                                    {`在对比画布定位 ${node.taskId}`}
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ) : null}
            </div>
        );
    }

    if (activeTab === 'schedule') {
        if (!diff.schedule.length) {
            return (
                <div className="offline-semantic-panel">
                    <SemanticEmptyCard
                        icon={<SlidersHorizontal size={22} aria-hidden="true" />}
                        title="调度配置无变更"
                        hint="两个版本的调度启停、调度周期、Cron 表达式及运行/调度时区完全一致。"
                    />
                </div>
            );
        }
        return (
            <div className="offline-semantic-panel">
                <section className="offline-semantic-section-card">
                    <div className="offline-semantic-section-head">
                        <div>
                            <h3>调度字段差异 ({diff.schedule.length})</h3>
                            <p>展示从基准版本到对比版本的调度策略变更明细</p>
                        </div>
                    </div>
                    <div className="offline-semantic-table-wrap">
                        <table className="offline-semantic-table">
                            <thead>
                                <tr>
                                    <th>配置项</th>
                                    <th>基准 ({formatRevisionTag(base.revision)})</th>
                                    <th>对比 ({formatRevisionTag(target.revision)})</th>
                                </tr>
                            </thead>
                            <tbody>
                                {diff.schedule.map((item) => (
                                    <tr key={item.field}>
                                        <td className="offline-semantic-field-cell">
                                            {SCHEDULE_FIELD_LABELS[item.field] ?? item.field}
                                        </td>
                                        <td className="is-diff-base">
                                            {formatScheduleFieldValue(item.field, item.baseValue)}
                                        </td>
                                        <td className="is-diff-target">
                                            {formatScheduleFieldValue(item.field, item.targetValue)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        );
    }

    if (activeTab === 'dependencies') {
        const hasAny = diff.dependencies.fields.length > 0 || diff.dependencies.items.length > 0;
        if (!hasAny) {
            return (
                <div className="offline-semantic-panel">
                    <SemanticEmptyCard
                        icon={<GitFork size={22} aria-hidden="true" />}
                        title="依赖配置无变更"
                        hint="两个版本的上游依赖任务清单、下游失败策略与跨项目组依赖限制完全一致。"
                    />
                </div>
            );
        }

        return (
            <div className="offline-semantic-panel">
                {diff.dependencies.fields.length > 0 ? (
                    <section className="offline-semantic-section-card">
                        <div className="offline-semantic-section-head">
                            <div>
                                <h3>依赖策略变更 ({diff.dependencies.fields.length})</h3>
                                <p>控制上游未就绪或跨项目组引用时的调度门禁规则</p>
                            </div>
                        </div>
                        <div className="offline-semantic-table-wrap">
                            <table className="offline-semantic-table">
                                <thead>
                                    <tr>
                                        <th>策略项</th>
                                        <th>基准 ({formatRevisionTag(base.revision)})</th>
                                        <th>对比 ({formatRevisionTag(target.revision)})</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {diff.dependencies.fields.map((field) => (
                                        <tr key={field.field}>
                                            <td className="offline-semantic-field-cell">
                                                {DEPENDENCY_FIELD_LABELS[field.field] ?? field.field}
                                            </td>
                                            <td className="is-diff-base">
                                                {formatDependencyFieldValue(field.field, field.baseValue)}
                                            </td>
                                            <td className="is-diff-target">
                                                {formatDependencyFieldValue(field.field, field.targetValue)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ) : null}

                {diff.dependencies.items.length > 0 ? (
                    <section className="offline-semantic-section-card">
                        <div className="offline-semantic-section-head">
                            <div>
                                <h3>上游任务依赖清单变更 ({diff.dependencies.items.length})</h3>
                                <p>当前工作流运行前必须满足成功状态的上游任务</p>
                            </div>
                        </div>
                        <ul className="offline-semantic-list">
                            {diff.dependencies.items.map((item) => {
                                const depRef = item.targetRef ?? item.baseRef;
                                return (
                                    <li key={item.key} className={`is-${item.kind.toLowerCase()}`}>
                                        <span className={`offline-diff-kind-pill is-${item.kind.toLowerCase()}`}>
                                            {DIFF_KIND_LABELS[item.kind]}
                                        </span>
                                        <span className="offline-semantic-dep-group">
                                            项目组 #{depRef?.groupId ?? '—'}
                                        </span>
                                        <code className="offline-semantic-dep-flow">
                                            {depRef?.flowId ?? item.key}
                                        </code>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ) : null}
            </div>
        );
    }

    const hasParamChanges = diff.parameters.groups.length > 0 || diff.parameters.definitions.length > 0;
    if (!hasParamChanges) {
        return (
            <div className="offline-semantic-panel">
                <SemanticEmptyCard
                    icon={<Variable size={22} aria-hidden="true" />}
                    title="绑定参数无变更"
                    hint="两个版本绑定的参数组版本与参数定义明细完全一致。"
                />
            </div>
        );
    }

    return (
        <div className="offline-semantic-panel">
            {diff.parameters.groups.length > 0 ? (
                <section className="offline-semantic-section-card">
                    <div className="offline-semantic-section-head">
                        <div>
                            <h3>参数组绑定变更 ({diff.parameters.groups.length})</h3>
                            <p>绑定的参数组新增、移除或切换版本</p>
                        </div>
                    </div>
                    <ul className="offline-semantic-list">
                        {diff.parameters.groups.map((group) => (
                            <li key={group.key} className={`is-${group.kind.toLowerCase()}`}>
                                <span className={`offline-diff-kind-pill is-${group.kind.toLowerCase()}`}>
                                    {DIFF_KIND_LABELS[group.kind]}
                                </span>
                                <strong className="offline-semantic-param-group-name">
                                    {group.targetName ?? group.baseName ?? group.key}
                                </strong>
                                <span className="offline-semantic-param-version-change">
                                    {group.baseVersion != null ? `v${group.baseVersion}` : '未绑定'}
                                    {' → '}
                                    {group.targetVersion != null ? `v${group.targetVersion}` : '已解绑'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {diff.parameters.definitions.length > 0 ? (
                <section className="offline-semantic-section-card">
                    <div className="offline-semantic-section-head">
                        <div>
                            <h3>参数定义差异 ({diff.parameters.definitions.length})</h3>
                            <p>系统基于脚本与传输配置扫描出的受影响节点，点击节点可定位检查</p>
                        </div>
                    </div>
                    <div className="offline-semantic-table-wrap">
                        <table className="offline-semantic-table">
                            <thead>
                                <tr>
                                    <th>参数键</th>
                                    <th>变更</th>
                                    <th>基准定义</th>
                                    <th>对比定义</th>
                                    <th>受影响节点</th>
                                </tr>
                            </thead>
                            <tbody>
                                {diff.parameters.definitions.map((entry) => (
                                    <tr key={entry.key}>
                                        <td className="offline-semantic-code-cell">{entry.key}</td>
                                        <td>
                                            <span className={`offline-diff-kind-pill is-${entry.kind.toLowerCase()}`}>
                                                {DIFF_KIND_LABELS[entry.kind]}
                                            </span>
                                        </td>
                                        <td className={entry.baseDefinition ? 'is-diff-base' : ''}>
                                            {entry.baseDefinition ? describeParameterDefinition(entry.baseDefinition) : '—'}
                                        </td>
                                        <td className={entry.targetDefinition ? 'is-diff-target' : ''}>
                                            {entry.targetDefinition ? describeParameterDefinition(entry.targetDefinition) : '—'}
                                        </td>
                                        <td>
                                            {entry.impactedTaskIds.length > 0 ? (
                                                <div className="offline-semantic-impact-chips">
                                                    {entry.impactedTaskIds.map((taskId) => {
                                                        const targetNode = diff.nodes.find((n) => n.taskId === taskId);
                                                        return (
                                                            <button
                                                                key={taskId}
                                                                type="button"
                                                                className="offline-semantic-impact-chip"
                                                                onClick={() => {
                                                                    if (onFocusNodeOnCanvas) {
                                                                        onFocusNodeOnCanvas(taskId);
                                                                    } else if (targetNode) {
                                                                        onSelectNode(targetNode);
                                                                    }
                                                                }}
                                                            >
                                                                {taskId}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <span className="offline-semantic-muted">暂无节点引用</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function SnapshotSummaryCard({
    roleLabel,
    tone,
    version,
    nodeCount,
    edgeCount,
    schedulePeriod,
}: {
    roleLabel: string;
    tone: 'base' | 'target';
    version: VersionSelection;
    nodeCount: number;
    edgeCount: number;
    schedulePeriod: string | null;
}) {
    const revTag = formatRevisionTag(version.revision);
    const shortLabel = formatVersionShortLabel(version);
    const isWorktree = isDevelopmentVersion(version);
    const headline = isWorktree
        ? shortLabel
        : version.onlineVersion != null
            ? `线上 v${version.onlineVersion}`
            : shortLabel !== revTag
                ? shortLabel
                : `提交 ${revTag}`;
    const hoverSummary = formatVersionTooltipSummary(version);

    const card = (
        <div className={`offline-semantic-version-card is-${tone} ${hoverSummary ? 'has-tooltip' : ''}`}>
            <div className="offline-semantic-version-card-top">
                <span className="offline-semantic-version-role">{roleLabel}</span>
                <code>{revTag}</code>
            </div>
            <strong className="offline-semantic-version-label">{headline}</strong>
            <div className="offline-semantic-version-meta">
                <span>节点 {nodeCount}</span>
                <span>·</span>
                <span>连线 {edgeCount}</span>
                {schedulePeriod ? (
                    <>
                        <span>·</span>
                        <span>调度 {schedulePeriod}</span>
                    </>
                ) : null}
            </div>
        </div>
    );

    return <VersionHoverTooltip version={version}>{card}</VersionHoverTooltip>;
}

function SemanticEmptyCard({
    icon,
    title,
    hint,
}: {
    icon: React.ReactNode;
    title: string;
    hint: string;
}) {
    return (
        <div className="offline-semantic-empty-card">
            <div className="offline-semantic-empty-icon">{icon ?? <FileDiff size={22} />}</div>
            <h4>{title}</h4>
            <p>{hint}</p>
        </div>
    );
}

function countNodes(snapshot: OfflineFlowVersionSnapshot): number {
    return (snapshot.document.stages ?? []).reduce((sum, stage) => sum + (stage.nodes?.length ?? 0), 0);
}
