import type { OfflineFlowNodeKind } from '../../api/offline';

export const OFFLINE_PALETTE_NODE_KINDS: OfflineFlowNodeKind[] = [
    'MYSQL',
    'POSTGRESQL',
    'CLICKHOUSE',
    'HIVE_SQL',
    'SHELL',
    'TRANSFER',
];

const SQL_EDITOR_NODE_KINDS: OfflineFlowNodeKind[] = [
    'SQL',
    'MYSQL',
    'POSTGRESQL',
    'CLICKHOUSE',
    'HIVE_SQL',
];

const JDBC_SQL_NODE_KINDS: OfflineFlowNodeKind[] = [
    'SQL',
    'MYSQL',
    'POSTGRESQL',
    'CLICKHOUSE',
];

function assertNever(value: never): never {
    throw new Error(`Unsupported offline node kind: ${value}`);
}

export function isOfflineFlowNodeKind(value: string): value is OfflineFlowNodeKind {
    return value === 'SQL'
        || value === 'MYSQL'
        || value === 'POSTGRESQL'
        || value === 'CLICKHOUSE'
        || value === 'HIVE_SQL'
        || value === 'SHELL'
        || value === 'TRANSFER';
}

export function isSqlEditorNodeKind(kind: OfflineFlowNodeKind) {
    return SQL_EDITOR_NODE_KINDS.includes(kind);
}

export function isJdbcSqlNodeKind(kind: OfflineFlowNodeKind) {
    return JDBC_SQL_NODE_KINDS.includes(kind);
}

export function getAllowedDataSourceTypes(kind: OfflineFlowNodeKind): string[] {
    switch (kind) {
        case 'SQL':
            return ['MYSQL', 'POSTGRESQL', 'CLICKHOUSE'];
        case 'MYSQL':
            return ['MYSQL'];
        case 'POSTGRESQL':
            return ['POSTGRESQL'];
        case 'CLICKHOUSE':
            return ['CLICKHOUSE'];
        case 'HIVE_SQL':
            return ['HIVE'];
        case 'SHELL':
        case 'TRANSFER':
            return [];
        default:
            return assertNever(kind);
    }
}

export function getDefaultDataSourceType(kind: OfflineFlowNodeKind): string | undefined {
    switch (kind) {
        case 'MYSQL':
        case 'POSTGRESQL':
        case 'CLICKHOUSE':
            return kind;
        case 'HIVE_SQL':
            return 'HIVE';
        case 'SQL':
        case 'SHELL':
        case 'TRANSFER':
            return undefined;
        default:
            return assertNever(kind);
    }
}

export function getOfflineNodeKindLabel(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
            return 'SQL';
        case 'MYSQL':
            return 'MySQL';
        case 'POSTGRESQL':
            return 'PostgreSQL';
        case 'CLICKHOUSE':
            return 'ClickHouse';
        case 'HIVE_SQL':
            return 'HiveSQL';
        case 'SHELL':
            return 'Shell';
        case 'TRANSFER':
            return 'Transfer';
        default:
            return assertNever(kind);
    }
}

export function getOfflineNodeKindDescription(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
            return 'SQL 节点';
        case 'MYSQL':
            return 'MySQL 查询节点';
        case 'POSTGRESQL':
            return 'PostgreSQL 查询节点';
        case 'CLICKHOUSE':
            return 'ClickHouse 查询节点';
        case 'HIVE_SQL':
            return 'HiveSQL 节点';
        case 'SHELL':
            return 'Shell 节点';
        case 'TRANSFER':
            return '数据传输节点';
        default:
            return assertNever(kind);
    }
}

export function getOfflineNodeKindClassName(kind: OfflineFlowNodeKind) {
    return kind.toLowerCase().replace(/_/g, '-');
}

export function getOfflineNodeScriptExtension(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
        case 'MYSQL':
        case 'POSTGRESQL':
        case 'CLICKHOUSE':
        case 'HIVE_SQL':
            return 'sql';
        case 'SHELL':
            return 'sh';
        case 'TRANSFER':
            return '';
        default:
            return assertNever(kind);
    }
}

export function getOfflineNodeDefaultScript(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
        case 'MYSQL':
        case 'POSTGRESQL':
        case 'CLICKHOUSE':
            return '-- Write your SQL query here\nSELECT 1;\n';
        case 'HIVE_SQL':
            return '-- Write your Hive SQL query here\nSELECT 1;\n';
        case 'SHELL':
            return '#!/bin/bash\necho "Hello World"\n';
        case 'TRANSFER':
            return '';
        default:
            return assertNever(kind);
    }
}
