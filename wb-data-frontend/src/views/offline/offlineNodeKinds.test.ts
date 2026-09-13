import { describe, expect, it } from 'vitest';

import {
    OFFLINE_PALETTE_NODE_KINDS,
    getAllowedDataSourceTypes,
    getOfflineNodeDefaultScript,
    getOfflineNodeKindDescription,
    getOfflineNodeKindLabel,
    getOfflineNodeScriptExtension,
    isJdbcSqlNodeKind,
    isOfflineFlowNodeKind,
    isSqlEditorNodeKind,
} from './offlineNodeKinds';

describe('offline node kinds', () => {
    it('recognizes transfer nodes and exposes scriptless helper defaults', () => {
        expect(isOfflineFlowNodeKind('TRANSFER')).toBe(true);
        expect(getOfflineNodeKindLabel('TRANSFER')).toBe('Transfer');
        expect(getOfflineNodeKindDescription('TRANSFER')).toBe('数据传输节点');
        expect(getAllowedDataSourceTypes('TRANSFER')).toEqual([]);
        expect(getOfflineNodeScriptExtension('TRANSFER')).toBe('');
        expect(getOfflineNodeDefaultScript('TRANSFER')).toBe('');
    });

    it('splits jdbc query nodes by database and keeps legacy SQL readable', () => {
        expect(isOfflineFlowNodeKind('MYSQL')).toBe(true);
        expect(isOfflineFlowNodeKind('POSTGRESQL')).toBe(true);
        expect(isOfflineFlowNodeKind('CLICKHOUSE')).toBe(true);
        expect(isOfflineFlowNodeKind('SQL')).toBe(true);
        expect(isJdbcSqlNodeKind('MYSQL')).toBe(true);
        expect(isJdbcSqlNodeKind('HIVE_SQL')).toBe(false);
        expect(isSqlEditorNodeKind('CLICKHOUSE')).toBe(true);
        expect(getOfflineNodeKindLabel('MYSQL')).toBe('MySQL');
        expect(getOfflineNodeKindLabel('POSTGRESQL')).toBe('PostgreSQL');
        expect(getOfflineNodeKindLabel('CLICKHOUSE')).toBe('ClickHouse');
        expect(getAllowedDataSourceTypes('MYSQL')).toEqual(['MYSQL']);
        expect(getAllowedDataSourceTypes('POSTGRESQL')).toEqual(['POSTGRESQL']);
        expect(getAllowedDataSourceTypes('CLICKHOUSE')).toEqual(['CLICKHOUSE']);
        expect(getAllowedDataSourceTypes('SQL')).toEqual(['MYSQL', 'POSTGRESQL', 'CLICKHOUSE']);
        expect(getOfflineNodeScriptExtension('MYSQL')).toBe('sql');
        expect(OFFLINE_PALETTE_NODE_KINDS).toEqual([
            'MYSQL',
            'POSTGRESQL',
            'CLICKHOUSE',
            'HIVE_SQL',
            'SHELL',
            'TRANSFER',
        ]);
    });
});
