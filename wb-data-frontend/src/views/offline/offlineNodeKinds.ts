import type { OfflineFlowNodeKind } from '../../api/offline';

const SQL_EDITOR_NODE_KINDS: OfflineFlowNodeKind[] = ['SQL', 'HIVE_SQL'];

export function isOfflineFlowNodeKind(value: string): value is OfflineFlowNodeKind {
    return value === 'SQL' || value === 'HIVE_SQL' || value === 'SHELL';
}

export function isSqlEditorNodeKind(kind: OfflineFlowNodeKind) {
    return SQL_EDITOR_NODE_KINDS.includes(kind);
}

export function getAllowedDataSourceTypes(kind: OfflineFlowNodeKind): string[] {
    switch (kind) {
        case 'SQL':
            return ['MYSQL', 'POSTGRESQL', 'STARROCKS'];
        case 'HIVE_SQL':
            return ['HIVE'];
        default:
            return [];
    }
}

export function getOfflineNodeKindLabel(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
            return 'SQL';
        case 'HIVE_SQL':
            return 'HiveSQL';
        case 'SHELL':
            return 'Shell';
    }
}

export function getOfflineNodeKindDescription(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
            return 'SQL 节点';
        case 'HIVE_SQL':
            return 'HiveSQL 节点';
        case 'SHELL':
            return 'Shell 节点';
    }
}

export function getOfflineNodeKindClassName(kind: OfflineFlowNodeKind) {
    return kind.toLowerCase().replace(/_/g, '-');
}

export function getOfflineNodeScriptExtension(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
            return 'sql';
        case 'HIVE_SQL':
            return 'sql';
        case 'SHELL':
            return 'sh';
    }
}

export function getOfflineNodeDefaultScript(kind: OfflineFlowNodeKind) {
    switch (kind) {
        case 'SQL':
            return '-- Write your SQL query here\nSELECT 1;\n';
        case 'HIVE_SQL':
            return '-- Write your Hive SQL query here\nSELECT 1;\n';
        case 'SHELL':
            return '#!/bin/bash\necho "Hello World"\n';
    }
}
