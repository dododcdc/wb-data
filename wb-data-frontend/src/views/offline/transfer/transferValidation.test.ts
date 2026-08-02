import { describe, expect, it } from 'vitest';

import { validateTransferConfig } from './transferValidation';

describe('validateTransferConfig', () => {
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
