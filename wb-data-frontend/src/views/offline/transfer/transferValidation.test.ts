import { describe, expect, it } from 'vitest';

import { validateTransferConfig } from './transferValidation';

describe('validateTransferConfig', () => {
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
