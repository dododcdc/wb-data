import type { OfflineFlowPublicationItem, OfflineFlowVersionItem } from '../../../api/offline';
import type { DiffKind } from './flowVersionDiff';

export interface VersionSelection {
    revision: string;
    label: string;
    kind?: 'DEVELOPMENT' | 'COMMIT';
    shortRevision?: string;
    message?: string | null;
    authorName?: string | null;
    committedAt?: string | null;
    onlineVersion?: number | null;
    currentOnline?: boolean;
    orderIndex?: number;
}

export const DIFF_KIND_LABELS: Record<DiffKind, string> = {
    ADDED: '新增',
    REMOVED: '删除',
    MODIFIED: '变更',
};

export const SCHEDULE_PERIOD_LABELS: Record<string, string> = {
    HOURLY: '每小时',
    DAILY: '每天',
    WEEKLY: '每周',
    MONTHLY: '每月',
    YEARLY: '每年',
    CUSTOM: '自定义',
};

export const SCHEDULE_FIELD_LABELS: Record<string, string> = {
    enabled: '调度状态',
    period: '调度周期',
    cron: 'Cron 表达式',
    timezone: '调度时区',
    runtimeTimezone: '运行时区',
    retryEnabled: '失败自动重试',
    retryCount: '重试次数',
    retryIntervalMinutes: '重试间隔',
};

export const DEPENDENCY_FIELD_LABELS: Record<string, string> = {
    failurePolicy: '下游失败策略',
    crossGroupDependency: '跨项目组依赖',
};

export const FAILURE_POLICY_LABELS: Record<string, string> = {
    CONTINUE: '继续调度',
    PAUSE: '暂停后续调度',
};

export const CROSS_GROUP_LABELS: Record<string, string> = {
    ALLOW: '允许跨项目组依赖',
    DENY: '仅同项目组依赖',
};

export const TRANSFER_ENDPOINT_FIELD_LABELS: Record<string, string> = {
    dataSourceId: '数据源',
    dataSourceType: '引擎类型',
    database: '数据库 / Schema',
    table: '表名',
    where: '过滤条件',
    writeMode: '写入模式',
    preSql: '前置 SQL',
    postSql: '后置 SQL',
};

export const TRANSFER_WRITE_MODE_HINTS: Record<string, string> = {
    append: '追加写入',
    overwrite_table: '覆盖整表',
    overwrite_partition: '覆盖分区',
    APPEND: '追加写入',
    OVERWRITE_TABLE: '覆盖整表',
    OVERWRITE_PARTITION: '覆盖分区',
};

export interface VersionMetadataLike {
    revision: string;
    label?: string | null;
    kind?: 'DEVELOPMENT' | 'COMMIT';
    shortRevision?: string | null;
    message?: string | null;
    authorName?: string | null;
    committedAt?: string | null;
    onlineVersion?: number | null;
    currentOnline?: boolean;
}

export function isDevelopmentVersion(version: Pick<VersionMetadataLike, 'revision' | 'kind'>): boolean {
    return version.revision === 'WORKTREE' || version.kind === 'DEVELOPMENT';
}

export function formatRevisionTag(revision: string): string {
    return revision === 'WORKTREE' ? '工作区' : revision.slice(0, 7);
}

export function formatVersionShortLabel(version: VersionMetadataLike): string {
    if (isDevelopmentVersion(version)) {
        return '当前工作区';
    }
    const revTag = version.shortRevision?.trim() || formatRevisionTag(version.revision);
    const hasCommitMetadata =
        version.kind === 'COMMIT'
        || Boolean(version.message?.trim())
        || Boolean(version.authorName?.trim())
        || Boolean(version.committedAt)
        || version.onlineVersion != null;
    if (hasCommitMetadata) {
        return revTag;
    }
    return version.label?.trim() || revTag;
}

export function formatVersionInlineText(version: VersionMetadataLike): string {
    if (isDevelopmentVersion(version)) {
        return '当前工作区';
    }
    const baseLabel = formatVersionShortLabel(version);
    if (version.onlineVersion != null) {
        return `线上 v${version.onlineVersion} · ${baseLabel}`;
    }
    return baseLabel;
}

export function getVersionTooltipDetails(version: VersionMetadataLike): {
    primary: string | null;
    secondary: string | null;
} {
    const message = version.message?.trim() || null;
    const secondaryParts: string[] = [];
    if (version.authorName?.trim()) {
        secondaryParts.push(version.authorName.trim());
    }
    if (version.committedAt) {
        secondaryParts.push(formatVersionTime(version.committedAt));
    }
    if (version.onlineVersion != null) {
        secondaryParts.push(version.currentOnline ? `当前线上 v${version.onlineVersion}` : `线上 v${version.onlineVersion}`);
    }
    return {
        primary: message,
        secondary: secondaryParts.length > 0 ? secondaryParts.join(' · ') : null,
    };
}

export function formatVersionTooltipSummary(version: VersionMetadataLike): string | undefined {
    const { primary, secondary } = getVersionTooltipDetails(version);
    const parts = [primary, secondary].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function formatWorktreeDirtySummary(dirty: boolean): string {
    return dirty ? '工作区有未提交修改' : '与最新提交一致';
}

export function formatFlowDisplayName(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : path;
}

export function buildWorktreeVersionSelection(item?: Pick<OfflineFlowVersionItem, 'dirty'>): VersionSelection {
    return {
        revision: 'WORKTREE',
        label: '开发版本',
        kind: 'DEVELOPMENT',
        shortRevision: '工作区',
        message: item ? formatWorktreeDirtySummary(item.dirty) : null,
        orderIndex: -1,
    };
}

export function buildCommitVersionSelection(item: OfflineFlowVersionItem, orderIndex: number): VersionSelection {
    const shortRev = item.revision.slice(0, 7);
    const currentOnline = item.publications.find((pub) => pub.currentOnline);
    const latestSuccessPub = currentOnline ?? item.publications.find((pub) => pub.status === 'SUCCESS');
    return {
        revision: item.revision,
        label: item.message || shortRev,
        kind: 'COMMIT',
        shortRevision: shortRev,
        message: item.message,
        authorName: item.authorName,
        committedAt: item.committedAt,
        onlineVersion: latestSuccessPub?.onlineVersion ?? null,
        currentOnline: Boolean(currentOnline),
        orderIndex,
    };
}

export function buildPublicationVersionSelection(
    item: OfflineFlowVersionItem,
    publication: OfflineFlowPublicationItem,
    orderIndex: number,
): VersionSelection {
    const shortSha = publication.afterSha.slice(0, 7);
    return {
        revision: publication.afterSha,
        label: `线上 v${publication.onlineVersion} · ${shortSha}`,
        kind: 'COMMIT',
        shortRevision: shortSha,
        message: item.message,
        authorName: item.authorName,
        committedAt: item.committedAt ?? publication.pushedAt,
        onlineVersion: publication.onlineVersion,
        currentOnline: publication.currentOnline,
        orderIndex,
    };
}

export function formatVersionTime(value?: string | null): string {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

export function formatDataSourceDisplay(
    dataSourceId?: number | null,
    dataSourceType?: string | null,
    dataSourceNames?: Record<number, string>,
): string {
    if (dataSourceId == null) {
        return dataSourceType || '—';
    }
    const name = dataSourceNames?.[dataSourceId];
    if (name) {
        return dataSourceType ? `${name} · ${dataSourceType} (#${dataSourceId})` : `${name} (#${dataSourceId})`;
    }
    return dataSourceType ? `${dataSourceType} #${dataSourceId}` : `#${dataSourceId}`;
}

export function formatScheduleFieldValue(field: string, value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === '') return '未配置';
    if (field === 'enabled') {
        return value === true || value === 'true' ? '已启用' : '未启用';
    }
    if (field === 'retryEnabled') {
        return value === true || value === 'true' ? '已开启' : '已关闭';
    }
    if (field === 'retryCount') {
        return `${value} 次`;
    }
    if (field === 'retryIntervalMinutes') {
        return `${value} 分钟`;
    }
    if (field === 'period') {
        const text = String(value);
        const label = SCHEDULE_PERIOD_LABELS[text];
        return label ? `${label} (${text})` : text;
    }
    return String(value);
}

export function formatDependencyFieldValue(field: string, value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === '') return '—';
    const text = String(value);
    if (field === 'failurePolicy') {
        return FAILURE_POLICY_LABELS[text] ?? text;
    }
    if (field === 'crossGroupDependency') {
        return CROSS_GROUP_LABELS[text] ?? text;
    }
    return text;
}

export function areTransferValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (left == null && right == null) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) return false;
        return left.every((item, idx) => areTransferValuesEqual(item, right[idx]));
    }
    if (
        typeof left === 'object'
        && typeof right === 'object'
        && left !== null
        && right !== null
        && !Array.isArray(left)
        && !Array.isArray(right)
    ) {
        const leftObj = left as Record<string, unknown>;
        const rightObj = right as Record<string, unknown>;
        const keys = new Set([...Object.keys(leftObj), ...Object.keys(rightObj)]);
        for (const key of keys) {
            if (!areTransferValuesEqual(leftObj[key], rightObj[key])) return false;
        }
        return true;
    }
    return false;
}

export function areTransferEndpointFieldsEqual(field: string, left: unknown, right: unknown): boolean {
    if (field === 'preSql' || field === 'postSql') {
        const normalizedLeft = Array.isArray(left) ? left : [];
        const normalizedRight = Array.isArray(right) ? right : [];
        return areTransferValuesEqual(normalizedLeft, normalizedRight);
    }
    if ((left === undefined || left === null || left === '') && (right === undefined || right === null || right === '')) {
        return true;
    }
    return areTransferValuesEqual(left, right);
}
