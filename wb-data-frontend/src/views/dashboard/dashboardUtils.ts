import type { WorkspaceDataSourceBrief, WorkspaceDataSourceTypeCount } from '../../api/workspace';
import { getExecutionPresentation } from '../../components/execution/executionPresentation';
import {
    getStoredLastDatabaseByDataSource,
    getStoredLastDataSourceId,
    LAST_DATASOURCE_STORAGE_KEY,
} from '../../constants/queryStorage';

export type PillTone = 'success' | 'teal' | 'warning' | 'danger' | 'info' | 'neutral';

const DATA_SOURCE_LABELS: Record<string, string> = {
    MYSQL: 'MySQL',
    HIVE: 'Hive',
    POSTGRESQL: 'PostgreSQL',
    CLICKHOUSE: 'ClickHouse',
    ORACLE: 'Oracle',
    SQLSERVER: 'SQL Server',
};

const DATA_SOURCE_BADGE_CLASS: Record<string, string> = {
    MYSQL: 'mysql',
    HIVE: 'hive',
    POSTGRESQL: 'postgresql',
    CLICKHOUSE: 'clickhouse',
    ORACLE: 'oracle',
    SQLSERVER: 'sqlserver',
};

const SCHEDULE_PERIOD_LABELS: Record<string, string> = {
    HOURLY: '小时调度',
    DAILY: '每日调度',
    WEEKLY: '每周调度',
    MONTHLY: '每月调度',
    YEARLY: '每年调度',
    CUSTOM: '自定义调度',
};

export function formatExecutionDuration(durationMs: number | null | undefined) {
    if (durationMs == null) return '—';
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${rest}s`;
}

export function formatRelativeTime(value: string | null | undefined) {
    if (!value) return '暂无时间';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '暂无时间';
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 60_000) return '刚刚';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return date.toLocaleDateString('zh-CN');
}

export function formatCount(value: number | null | undefined) {
    return (value ?? 0).toLocaleString('en-US');
}

export function resolveRoleLabel(role: string | null | undefined) {
    if (role === 'SYSTEM_ADMIN') return '系统管理员';
    if (role === 'GROUP_ADMIN') return '组管理员';
    if (role === 'ANALYST') return '分析师';
    return '开发者';
}

export function executionStatusTone(status: string | null | undefined): PillTone {
    if (status === 'FORCE_SUCCESS') return 'teal';
    const tone = getExecutionPresentation(status).dotTone;
    if (tone === 'success') return 'success';
    if (tone === 'failed') return 'danger';
    if (tone === 'running') return 'info';
    return 'neutral';
}

export function dataSourceTypeLabel(type: string | null | undefined) {
    const normalized = (type ?? '').trim().toUpperCase();
    return DATA_SOURCE_LABELS[normalized] ?? (normalized || '未知');
}

export function dataSourceTypeBadgeClass(type: string | null | undefined) {
    const normalized = (type ?? '').trim().toUpperCase();
    const variant = DATA_SOURCE_BADGE_CLASS[normalized];
    return variant ? `type-badge ${variant}` : 'type-badge';
}

export function formatDataSourceBreakdown(byType: WorkspaceDataSourceTypeCount[] | undefined) {
    if (!byType || byType.length === 0) return '暂无数据源';
    return byType.slice(0, 4).map((item) => `${dataSourceTypeLabel(item.type)} ${item.count}`).join(' · ');
}

export function formatScheduleMeta(scheduleState: string, schedulePeriod: string | null) {
    if (scheduleState === 'ENABLED') {
        return schedulePeriod ? (SCHEDULE_PERIOD_LABELS[schedulePeriod] ?? '已启用调度') : '已启用调度';
    }
    if (scheduleState === 'DISABLED') {
        return '调度已暂停';
    }
    return '手动任务';
}

export function schedulePillInfo(scheduleState: string): { tone: PillTone; label: string } {
    if (scheduleState === 'ENABLED') return { tone: 'success', label: '已启用' };
    if (scheduleState === 'DISABLED') return { tone: 'warning', label: '已暂停' };
    return { tone: 'neutral', label: '未调度' };
}

export function gitSyncStatusInfo(status: string | null | undefined): { tone: PillTone; label: string } {
    const normalized = (status ?? '').trim().toUpperCase();
    if (normalized === 'SUCCESS') return { tone: 'success', label: '正常' };
    if (normalized === 'RUNNING' || normalized === 'CREATED' || normalized === 'QUEUED') {
        return { tone: 'info', label: '同步中' };
    }
    if (normalized === 'FAILED' || normalized === 'ERROR') return { tone: 'danger', label: '异常' };
    return { tone: 'neutral', label: '待同步' };
}

export interface LastQueryContext {
    dataSource: WorkspaceDataSourceBrief;
    databaseName: string | null;
    fromHistory: boolean;
}

export function resolveLastQueryContext(items: WorkspaceDataSourceBrief[] | undefined): LastQueryContext | null {
    if (!items || items.length === 0) return null;
    const storedId = getStoredLastDataSourceId();
    const storedDbMap = getStoredLastDatabaseByDataSource();
    const matched = storedId ? items.find((item) => String(item.id) === storedId) : undefined;
    if (matched) {
        return {
            dataSource: matched,
            databaseName: storedDbMap[String(matched.id)] ?? matched.databaseName ?? null,
            fromHistory: true,
        };
    }
    const fallback = items.find((item) => item.status?.toUpperCase() === 'ENABLED') ?? items[0];
    if (!fallback) return null;
    return {
        dataSource: fallback,
        databaseName: storedDbMap[String(fallback.id)] ?? fallback.databaseName ?? null,
        fromHistory: false,
    };
}

export function rememberSelectedQueryDataSource(dataSourceId: number) {
    try {
        localStorage.setItem(LAST_DATASOURCE_STORAGE_KEY, String(dataSourceId));
    } catch {
        // Ignore storage errors (e.g. private browsing).
    }
}
