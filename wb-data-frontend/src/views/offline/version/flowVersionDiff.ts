import type {
    FlowParameterBindingItem,
    FlowParameterDefinitionSnapshot,
    OfflineFlowDependencyRef,
    OfflineFlowDependencySettings,
    OfflineFlowEdge,
    OfflineFlowNode,
    OfflineFlowVersionSnapshot,
} from '../../../api/offline';
import { areHiveConfsEqual } from '../editor/hiveConf';

export type DiffKind = 'ADDED' | 'REMOVED' | 'MODIFIED';

export interface VersionSnapshotNode extends OfflineFlowNode {
    stageId?: string;
    parallel?: boolean;
}

export interface NodeVersionDiff {
    taskId: string;
    kind: DiffKind;
    contentChanged: boolean;
    configChanged: boolean;
    hiveConfChanged?: boolean;
    scriptPathChanged?: boolean;
    structureChanged: boolean;
    upstreamChanged: boolean;
    referencedParametersAdded: string[];
    referencedParametersRemoved: string[];
    baseNode: VersionSnapshotNode | null;
    targetNode: VersionSnapshotNode | null;
}

export interface EdgeVersionDiff {
    key: string;
    kind: DiffKind;
    baseEdge: OfflineFlowEdge | null;
    targetEdge: OfflineFlowEdge | null;
}

export interface FieldVersionDiff {
    field: string;
    baseValue: string | number | boolean | null;
    targetValue: string | number | boolean | null;
}

export interface DependencyVersionDiff {
    items: Array<{
        key: string;
        kind: DiffKind;
        baseRef: OfflineFlowDependencyRef | null;
        targetRef: OfflineFlowDependencyRef | null;
    }>;
    fields: FieldVersionDiff[];
}

export interface ParameterGroupVersionDiff {
    key: string;
    kind: DiffKind;
    baseName: string | null;
    targetName: string | null;
    baseVersion: number | null;
    targetVersion: number | null;
}

export interface ParameterDefinitionVersionDiff {
    key: string;
    kind: DiffKind;
    baseDefinition: FlowParameterDefinitionSnapshot | null;
    targetDefinition: FlowParameterDefinitionSnapshot | null;
    impactedTaskIds: string[];
}

export interface FlowVersionDiff {
    nodes: NodeVersionDiff[];
    edges: EdgeVersionDiff[];
    schedule: FieldVersionDiff[];
    dependencies: DependencyVersionDiff;
    parameters: {
        groups: ParameterGroupVersionDiff[];
        definitions: ParameterDefinitionVersionDiff[];
    };
    summary: {
        nodes: number;
        schedule: number;
        dependencies: number;
        parameters: number;
    };
}

interface NodeWithStage extends OfflineFlowNode {
    stageId: string;
    parallel: boolean;
}

export function diffFlowVersions(base: OfflineFlowVersionSnapshot, target: OfflineFlowVersionSnapshot): FlowVersionDiff {
    const baseNodes = flattenNodes(base);
    const targetNodes = flattenNodes(target);
    const baseEdges = edgeMap(base.document.edges);
    const targetEdges = edgeMap(target.document.edges);
    const nodes = diffNodes(baseNodes, targetNodes, baseEdges, targetEdges, base.nodeMetadata, target.nodeMetadata);
    const edges = diffEdges(baseEdges, targetEdges);
    const schedule = diffSchedule(base, target);
    const dependencies = diffDependencies(base.document.dependencyConfig, target.document.dependencyConfig);
    const parameters = diffParameters(base, target);
    return {
        nodes,
        edges,
        schedule,
        dependencies,
        parameters,
        summary: {
            nodes: nodes.filter((node) => node.kind !== 'MODIFIED' || hasNodeChanges(node)).length,
            schedule: schedule.length,
            dependencies: dependencies.items.length + dependencies.fields.length,
            parameters: parameters.groups.length + parameters.definitions.length,
        },
    };
}

export function countTotalSemanticChanges(diff: FlowVersionDiff): number {
    return (
        diff.summary.nodes
        + diff.edges.length
        + diff.summary.schedule
        + diff.summary.dependencies
        + diff.summary.parameters
    );
}

export function hasNodeChanges(node: NodeVersionDiff) {
    return node.kind !== 'MODIFIED'
        || node.contentChanged
        || node.configChanged
        || Boolean(node.hiveConfChanged)
        || node.scriptPathChanged
        || node.structureChanged
        || node.referencedParametersAdded.length > 0
        || node.referencedParametersRemoved.length > 0;
}

export function getNodeChangeReasons(node: NodeVersionDiff): string[] {
    if (node.kind === 'ADDED') {
        return ['新增节点'];
    }
    if (node.kind === 'REMOVED') {
        return ['删除节点'];
    }
    const reasons: string[] = [];
    if (node.contentChanged) {
        const activeNode = node.targetNode ?? node.baseNode;
        reasons.push(activeNode?.kind === 'TRANSFER' ? '传输配置' : '脚本');
    }
    if (node.configChanged) {
        reasons.push('数据源/类型');
    }
    if (node.hiveConfChanged) {
        reasons.push('Hive 运行参数');
    }
    if (node.scriptPathChanged) {
        reasons.push('脚本路径');
    }
    if (node.structureChanged) {
        reasons.push('执行阶段');
    }
    if (node.upstreamChanged) {
        reasons.push('上游连线');
    }
    if (node.referencedParametersAdded.length > 0 || node.referencedParametersRemoved.length > 0) {
        reasons.push('参数引用');
    }
    return reasons;
}

function flattenNodes(snapshot: OfflineFlowVersionSnapshot) {
    return new Map(snapshot.document.stages.flatMap((stage) =>
        stage.nodes.map((node): [string, NodeWithStage] => [
            node.taskId,
            { ...node, stageId: stage.stageId, parallel: stage.parallel },
        ])));
}

function edgeMap(edges: OfflineFlowEdge[]) {
    return new Map(edges.map((edge) => [`${edge.source}->${edge.target}`, edge]));
}

function diffNodes(
    baseNodes: Map<string, NodeWithStage>,
    targetNodes: Map<string, NodeWithStage>,
    baseEdges: Map<string, OfflineFlowEdge>,
    targetEdges: Map<string, OfflineFlowEdge>,
    baseMetadata: OfflineFlowVersionSnapshot['nodeMetadata'],
    targetMetadata: OfflineFlowVersionSnapshot['nodeMetadata'],
) {
    const ids = new Set([...baseNodes.keys(), ...targetNodes.keys()]);
    return [...ids].sort().map((taskId): NodeVersionDiff => {
        const baseNode = baseNodes.get(taskId) ?? null;
        const targetNode = targetNodes.get(taskId) ?? null;
        const baseParameters = new Set(readReferencedParameters(baseMetadata, taskId));
        const targetParameters = new Set(readReferencedParameters(targetMetadata, taskId));
        const referencedParametersAdded = [...targetParameters].filter((key) => !baseParameters.has(key)).sort();
        const referencedParametersRemoved = [...baseParameters].filter((key) => !targetParameters.has(key)).sort();
        const contentChanged = (baseNode?.scriptContent ?? null) !== (targetNode?.scriptContent ?? null)
            || JSON.stringify(baseNode?.transfer ?? null) !== JSON.stringify(targetNode?.transfer ?? null);
        const configChanged = (baseNode?.kind ?? null) !== (targetNode?.kind ?? null)
            || (baseNode?.dataSourceId ?? null) !== (targetNode?.dataSourceId ?? null)
            || (baseNode?.dataSourceType ?? null) !== (targetNode?.dataSourceType ?? null);
        const hiveConfChanged = !areHiveConfsEqual(baseNode?.hiveConf, targetNode?.hiveConf);
        const scriptPathChanged = (baseNode?.scriptPath ?? null) !== (targetNode?.scriptPath ?? null);
        const structureChanged = (baseNode?.stageId ?? null) !== (targetNode?.stageId ?? null)
            || (baseNode?.parallel ?? null) !== (targetNode?.parallel ?? null);
        const upstreamChanged = upstreamFor(taskId, baseEdges) !== upstreamFor(taskId, targetEdges);
        const kind: DiffKind = !baseNode ? 'ADDED' : !targetNode ? 'REMOVED' : 'MODIFIED';
        return {
            taskId,
            kind,
            contentChanged,
            configChanged,
            hiveConfChanged,
            scriptPathChanged,
            structureChanged,
            upstreamChanged,
            referencedParametersAdded,
            referencedParametersRemoved,
            baseNode,
            targetNode,
        };
    });
}

function upstreamFor(taskId: string, edges: Map<string, OfflineFlowEdge>) {
    return [...edges.values()]
        .filter((edge) => edge.target === taskId)
        .map((edge) => edge.source)
        .sort()
        .join(',');
}

function diffEdges(baseEdges: Map<string, OfflineFlowEdge>, targetEdges: Map<string, OfflineFlowEdge>) {
    const keys = new Set([...baseEdges.keys(), ...targetEdges.keys()]);
    return [...keys].sort().flatMap((key): EdgeVersionDiff[] => {
        const baseEdge = baseEdges.get(key) ?? null;
        const targetEdge = targetEdges.get(key) ?? null;
        if (baseEdge && targetEdge && JSON.stringify(baseEdge) === JSON.stringify(targetEdge)) {
            return [];
        }
        return [{
            key,
            kind: !baseEdge ? 'ADDED' : !targetEdge ? 'REMOVED' : 'MODIFIED',
            baseEdge,
            targetEdge,
        }];
    });
}

function diffSchedule(base: OfflineFlowVersionSnapshot, target: OfflineFlowVersionSnapshot) {
    const fields: FieldVersionDiff[] = [];
    const baseSchedule = base.document.schedule;
    const targetSchedule = target.document.schedule;
    addField(fields, 'period', baseSchedule?.period ?? null, targetSchedule?.period ?? null);
    addField(fields, 'cron', baseSchedule?.cron ?? null, targetSchedule?.cron ?? null);
    addField(fields, 'timezone', baseSchedule?.timezone ?? null, targetSchedule?.timezone ?? null);
    addField(fields, 'enabled', baseSchedule?.enabled ?? null, targetSchedule?.enabled ?? null);
    addField(fields, 'runtimeTimezone', base.document.runtimeTimezone ?? null, target.document.runtimeTimezone ?? null);
    return fields;
}

function diffDependencies(base: OfflineFlowDependencySettings | null | undefined, target: OfflineFlowDependencySettings | null | undefined): DependencyVersionDiff {
    const baseRefs = new Map((base?.dependencies ?? []).map((ref) => [`${ref.groupId}:${ref.flowId}`, ref]));
    const targetRefs = new Map((target?.dependencies ?? []).map((ref) => [`${ref.groupId}:${ref.flowId}`, ref]));
    const keys = new Set([...baseRefs.keys(), ...targetRefs.keys()]);
    const items = [...keys].sort().flatMap((key) => {
        const baseRef = baseRefs.get(key) ?? null;
        const targetRef = targetRefs.get(key) ?? null;
        if (baseRef && targetRef && JSON.stringify(baseRef) === JSON.stringify(targetRef)) {
            return [];
        }
        return [{
            key,
            kind: !baseRef ? 'ADDED' as const : !targetRef ? 'REMOVED' as const : 'MODIFIED' as const,
            baseRef,
            targetRef,
        }];
    });
    const fields: FieldVersionDiff[] = [];
    addField(fields, 'failurePolicy', base?.failurePolicy ?? 'CONTINUE', target?.failurePolicy ?? 'CONTINUE');
    addField(fields, 'crossGroupDependency', base?.crossGroupDependency ?? 'ALLOW', target?.crossGroupDependency ?? 'ALLOW');
    return { items, fields };
}

function diffParameters(base: OfflineFlowVersionSnapshot, target: OfflineFlowVersionSnapshot) {
    const baseGroups = parameterGroups(base);
    const targetGroups = parameterGroups(target);
    const keys = new Set([...baseGroups.keys(), ...targetGroups.keys()]);
    const groups = [...keys].sort().map((key): ParameterGroupVersionDiff => {
        const baseGroup = baseGroups.get(key) ?? null;
        const targetGroup = targetGroups.get(key) ?? null;
        return {
            key,
            kind: !baseGroup ? 'ADDED' : !targetGroup ? 'REMOVED' : 'MODIFIED',
            baseName: baseGroup?.name ?? baseGroup?.code ?? null,
            targetName: targetGroup?.name ?? targetGroup?.code ?? null,
            baseVersion: baseGroup?.boundVersion ?? null,
            targetVersion: targetGroup?.boundVersion ?? null,
        };
    }).filter((group) => group.kind !== 'MODIFIED' || group.baseVersion !== group.targetVersion || group.baseName !== group.targetName);

    const baseDefinitions = parameterDefinitions(baseGroups);
    const targetDefinitions = parameterDefinitions(targetGroups);
    const definitionKeys = new Set([...baseDefinitions.keys(), ...targetDefinitions.keys()]);
    const definitions = [...definitionKeys].sort().map((key): ParameterDefinitionVersionDiff => {
        const baseDefinition = baseDefinitions.get(key) ?? null;
        const targetDefinition = targetDefinitions.get(key) ?? null;
        return {
            key,
            kind: !baseDefinition ? 'ADDED' : !targetDefinition ? 'REMOVED' : 'MODIFIED',
            baseDefinition,
            targetDefinition,
            impactedTaskIds: impactedTasks(base, target, key),
        };
    }).filter((entry) => entry.kind !== 'MODIFIED' || JSON.stringify(entry.baseDefinition) !== JSON.stringify(entry.targetDefinition));
    return { groups, definitions };
}

function parameterGroups(snapshot: OfflineFlowVersionSnapshot) {
    const binding = snapshot.document.parameterBinding;
    const groups = binding?.bindings?.length ? binding.bindings : binding ? [binding] : [];
    return new Map(groups.map((group) => [String(group.parameterGroupId ?? group.code), group]));
}

function parameterDefinitions(groups: Map<string, FlowParameterBindingItem>) {
    return new Map([...groups.values()].flatMap((group) =>
        group.definitions.map((definition): [string, FlowParameterDefinitionSnapshot] => [
            `${group.parameterGroupId ?? group.code}:${definition.key}`,
            definition,
        ])));
}

function readReferencedParameters(
    nodeMetadata: OfflineFlowVersionSnapshot['nodeMetadata'] | undefined,
    taskId: string,
): string[] {
    const entry = nodeMetadata?.[taskId] as { referencedParameters?: string[] } | string[] | undefined;
    if (!entry) return [];
    if (Array.isArray(entry)) return entry;
    return Array.isArray(entry.referencedParameters) ? entry.referencedParameters : [];
}

function impactedTasks(base: OfflineFlowVersionSnapshot, target: OfflineFlowVersionSnapshot, parameterKey: string) {
    const key = parameterKey.split(':').pop() ?? parameterKey;
    const taskIds = new Set<string>();
    for (const snapshot of [base, target]) {
        for (const taskId of Object.keys(snapshot.nodeMetadata ?? {})) {
            if (readReferencedParameters(snapshot.nodeMetadata, taskId).includes(key)) {
                taskIds.add(taskId);
            }
        }
    }
    return [...taskIds].sort();
}

function addField(fields: FieldVersionDiff[], field: string, baseValue: FieldVersionDiff['baseValue'], targetValue: FieldVersionDiff['targetValue']) {
    if (baseValue !== targetValue) {
        fields.push({ field, baseValue, targetValue });
    }
}
