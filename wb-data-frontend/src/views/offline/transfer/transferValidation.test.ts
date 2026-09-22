import { describe, expect, it } from 'vitest';

import type { TransferConfig } from './transferTypes';
import { validateTransferConfig } from './transferValidation';

const sqlTransfer: TransferConfig = {
    source: { dataSourceId: 1, dataSourceType: 'MYSQL', database: 'demo', table: 'orders' },
    target: { dataSourceId: 2, dataSourceType: 'MYSQL', database: 'demo', table: 'orders_target', writeMode: 'append' },
    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
};

describe('validateTransferConfig', () => {
    describe.each([['preSql', '前置 SQL'], ['postSql', '后置 SQL']] as const)('%s', (key, label) => {
        it.each([0, 5, 6])('validates the independent limit for %i statements', (count) => {
            const config: TransferConfig = {
                ...sqlTransfer,
                target: {
                    ...sqlTransfer.target,
                    preSql: Array(5).fill('DELETE FROM staging'),
                    postSql: Array(5).fill('ANALYZE orders_target'),
                    [key]: Array(count).fill('SELECT 1'),
                },
            };

            const result = validateTransferConfig(config, ['id'], []);

            expect(result.valid).toBe(count <= 5);
            expect(result.errors).toEqual(count > 5 ? [`目标${label}最多配置 5 条`] : []);
        });

        it.each(['', ' \n\t '])('rejects an empty statement without removing it: %j', (sql) => {
            const config: TransferConfig = {
                ...sqlTransfer,
                target: { ...sqlTransfer.target, [key]: ['SELECT 1', sql] },
            };

            const result = validateTransferConfig(config, ['id'], []);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(`目标${label}第 2 条不能为空`);
            expect(config.target[key]).toEqual(['SELECT 1', sql]);
        });

        it.each(['SELECT 1', ''])('rejects nonempty source SQL lists: %j', (sql) => {
            const result = validateTransferConfig({
                ...sqlTransfer,
                source: { ...sqlTransfer.source, [key]: [sql] },
            }, ['id'], []);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('来源不支持前置或后置 SQL，请移除来源 SQL 配置');
        });

        it.each(['MYSQL', 'POSTGRESQL', 'CLICKHOUSE', 'HIVE'] as const)(
            'permits configured SQL only for supported target types: %s',
            (dataSourceType) => {
                const result = validateTransferConfig({
                    ...sqlTransfer,
                    target: { ...sqlTransfer.target, dataSourceType, [key]: ['SELECT 1'] },
                }, ['id'], []);

                expect(result.valid).toBe(dataSourceType !== 'HIVE');
                expect(result.errors).toEqual(dataSourceType === 'HIVE'
                    ? ['前置和后置 SQL 仅支持 MYSQL、POSTGRESQL、CLICKHOUSE 目标']
                    : []);
            },
        );
    });

    it('allows omitted or empty SQL lists on existing Hive transfers and sources', () => {
        for (const sql of [undefined, []]) {
            expect(validateTransferConfig({
                ...sqlTransfer,
                source: { ...sqlTransfer.source, preSql: sql, postSql: sql },
                target: { ...sqlTransfer.target, dataSourceType: 'HIVE', preSql: sql, postSql: sql },
            }, ['id'], []).valid).toBe(true);
        }
    });

    it('preserves multiline SQL verbatim and leaves lexical checks to the backend', () => {
        const preSql = ["  UPDATE orders_target\nSET status = '中文;内容'\nWHERE id = 1;  "];
        const postSql = ['SELECT 1; SELECT 2;'];
        const config: TransferConfig = {
            ...sqlTransfer,
            target: { ...sqlTransfer.target, preSql, postSql },
        };
        const before = JSON.stringify(config);

        expect(validateTransferConfig(config, ['id'], []).valid).toBe(true);
        expect(JSON.stringify(config)).toBe(before);
    });

    it('does not report mapping errors before both endpoints are complete', () => {
        const result = validateTransferConfig({
            source: { dataSourceId: 0, dataSourceType: 'MYSQL', table: '' },
            target: {
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                database: 'default',
                table: 'dwd_orders',
                writeMode: 'append',
            },
            fieldMappings: [],
        }, ['id', 'amount'], []);

        expect(result.errors).toEqual(['请选择来源数据源']);
        expect(result.unmappedTargetColumns).toEqual([]);
    });

    it('rejects a filter condition that repeats the WHERE keyword', () => {
        const result = validateTransferConfig({
            source: {
                dataSourceId: 1,
                dataSourceType: 'MYSQL',
                database: 'transfer_demo',
                table: 'orders',
                where: "WHERE status = 'ACTIVE'",
            },
            target: {
                dataSourceId: 2,
                dataSourceType: 'MYSQL',
                database: 'transfer_demo',
                table: 'orders_target',
                writeMode: 'append',
            },
            fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
        }, ['id'], []);

        expect(result.errors).toContain('过滤条件无需填写 WHERE');
        expect(result.valid).toBe(false);
    });

    it('requires source and target databases', () => {
        const config = {
            source: { dataSourceId: 1, dataSourceType: 'MYSQL' as const, table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'HIVE' as const, table: 'dwd_orders', writeMode: 'append' as const },
            fieldMappings: [{ target: 'id', kind: 'source_field' as const, source: 'id' }],
        };

        const result = validateTransferConfig(config, ['id'], []);

        expect(result.errors).toContain('请选择来源数据库');
        expect(result.errors).toContain('请选择目标数据库');
    });

    it('blocks a target column without a mapping', () => {
        const result = validateTransferConfig({
            source: { dataSourceId: 1, dataSourceType: 'MYSQL', database: 'transfer_demo', table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'HIVE', database: 'default', table: 'dwd_orders', writeMode: 'append' },
            fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
        }, ['id', 'amount'], []);

        expect(result.errors).toContain('目标字段 amount 尚未配置映射');
    });

    it('rejects mappings whose source or target fields no longer exist', () => {
        const result = validateTransferConfig({
            source: { dataSourceId: 1, dataSourceType: 'MYSQL', database: 'transfer_demo', table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'MYSQL', database: 'transfer_demo', table: 'orders_target', writeMode: 'append' },
            fieldMappings: [
                { target: 'id', kind: 'source_field', source: 'removed_source' },
                { target: 'removed_target', kind: 'source_field', source: 'id' },
            ],
        }, ['id'], [], ['id']);

        expect(result.errors).toContain('来源字段 removed_source 已不存在');
        expect(result.errors).toContain('目标字段 removed_target 已不存在，请移除失效映射');
        expect(result.invalidSourceMappings).toEqual(['id']);
        expect(result.staleTargetMappings).toEqual(['removed_target']);
    });

    it('requires every Hive partition mapping for partition overwrite', () => {
        const result = validateTransferConfig({
            source: { dataSourceId: 1, dataSourceType: 'MYSQL', database: 'transfer_demo', table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'HIVE', database: 'default', table: 'dwd_orders', writeMode: 'overwrite_partition' },
            fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
            partitions: [],
        }, ['id'], ['dayno']);

        expect(result.errors).toContain('分区字段 dayno 尚未配置映射');
    });
});
