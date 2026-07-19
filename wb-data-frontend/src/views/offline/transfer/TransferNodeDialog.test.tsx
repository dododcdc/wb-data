import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferNodeDialog } from './TransferNodeDialog';

const metadata = {
    dataSources: [],
    sourceTables: [],
    targetTables: [],
    sourceMetadata: { columns: [{ name: 'id' }] },
    targetMetadata: {
        columns: [{ name: 'id' }],
        partitionColumns: [{ name: 'dayno' }],
        partitioned: true,
        writeModes: [
            { value: 'append', label: 'Append' },
            { value: 'overwrite_partition', label: 'Overwrite partition' },
        ],
    },
};

vi.mock('./useTransferMetadata', () => ({
    useTransferMetadata: () => metadata,
}));

afterEach(cleanup);

describe('TransferNodeDialog', () => {
    it('shows predicate input and separate Hive partition mappings without table overwrite', () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders', where: "status = 'ACTIVE'" },
                    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'append' },
                    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
                    partitions: [{ target: 'dayno', kind: 'static_value', value: '20260719' }],
                }}
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByDisplayValue("status = 'ACTIVE'")).toBeTruthy();
        expect(screen.getByText('Hive 分区字段')).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'Overwrite table' })).toBeNull();
    });
});
