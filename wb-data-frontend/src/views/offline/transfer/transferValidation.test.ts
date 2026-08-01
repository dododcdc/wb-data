import { describe, expect, it } from 'vitest';

import { validateTransferConfig } from './transferValidation';

describe('validateTransferConfig', () => {
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
            source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'append' },
            fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
        }, ['id', 'amount'], []);

        expect(result.errors).toContain('目标字段 amount 尚未配置映射');
    });

    it('requires every Hive partition mapping for partition overwrite', () => {
        const result = validateTransferConfig({
            source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'overwrite_partition' },
            fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
            partitions: [],
        }, ['id'], ['dayno']);

        expect(result.errors).toContain('分区字段 dayno 尚未配置映射');
    });
});
