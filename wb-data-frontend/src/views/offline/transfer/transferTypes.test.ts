import { describe, expect, it } from 'vitest';

import type {
    TransferConfig,
    TransferFieldMapping,
    TransferMappingKind,
    TransferWriteMode,
} from './transferTypes';
import type { OfflineFlowNode, SaveOfflineFlowNodeRequest } from '@/api/offline';
import { getTransferWriteModes, transferMappingKinds } from './transferTypes';

describe('transfer types', () => {
    it('uses the backend JSON contract for a transfer configuration', () => {
        const kind: TransferMappingKind = 'source_expression';
        const writeMode: TransferWriteMode = 'append';
        const mapping: TransferFieldMapping = {
            target: 'dayno',
            kind,
            expression: "date_format(date_key, '%Y%m%d')",
        };
        const transfer: TransferConfig = {
            source: {
                dataSourceId: 1,
                dataSourceType: 'MYSQL',
                database: 'source_db',
                table: 'orders',
                where: "id = '12323'",
            },
            target: {
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                database: 'target_db',
                table: 'dwd_orders',
                writeMode,
            },
            fieldMappings: [mapping],
            partitions: [],
        };

        const node = {
            taskId: 'transfer_orders',
            kind: 'TRANSFER',
            transfer,
        } satisfies OfflineFlowNode;
        const saveRequest = node satisfies SaveOfflineFlowNodeRequest;

        expect(JSON.stringify(saveRequest)).not.toContain('scriptPath');
        expect(JSON.stringify(saveRequest)).not.toContain('scriptContent');
        expect(transfer).toMatchObject({
            source: { dataSourceId: 1, table: 'orders' },
            target: { writeMode: 'append' },
            fieldMappings: [{ kind: 'source_expression' }],
        });
        expect(transferMappingKinds).toContain('source_expression');
        expect(getTransferWriteModes(false)).toEqual(['append', 'overwrite_table']);
        expect(getTransferWriteModes(true)).toEqual(['append', 'overwrite_partition']);
    });
});
