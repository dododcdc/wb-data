import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferNodeDialog } from './TransferNodeDialog';
import type { TransferConfig, TransferWriteMode } from './transferTypes';

interface MockTransferMetadata {
    dataSources: [];
    sourceTables: string[];
    targetTables: string[];
    sourceMetadata: { columns: Array<{ name: string }> } | null;
    targetMetadata: {
        columns: Array<{ name: string }>;
        partitionColumns: Array<{ name: string }>;
        partitioned: boolean;
        writeModes: Array<{ value: TransferWriteMode; label: string }>;
    } | null;
}

let metadata: MockTransferMetadata = {
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

const validTransfer: TransferConfig = {
    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders', where: "status = 'ACTIVE'" },
    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'append' },
    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
    partitions: [{ target: 'dayno', kind: 'static_value', value: '20260719' }],
};

afterEach(() => {
    cleanup();
    metadata = {
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
});

describe('TransferNodeDialog', () => {
    it('shows predicate input and separate Hive partition mappings without table overwrite', () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={validTransfer}
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByDisplayValue("status = 'ACTIVE'")).toBeTruthy();
        expect(screen.getByText('Hive 分区字段')).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'Overwrite table' })).toBeNull();
    });

    it('does not emit invalid transfer configs for draft staging', async () => {
        metadata = {
            ...metadata,
            targetMetadata: {
                ...metadata.targetMetadata!,
                columns: [{ name: 'id' }, { name: 'amount' }],
            },
        };
        const onChange = vi.fn();

        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
                }}
                onChange={onChange}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('目标字段 amount 尚未配置映射')).toBeTruthy();
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('defaults same-name mappings when source metadata arrives after target metadata', async () => {
        metadata = {
            ...metadata,
            sourceMetadata: null,
            targetMetadata: {
                columns: [{ name: 'id' }],
                partitionColumns: [],
                partitioned: false,
                writeModes: [{ value: 'append', label: 'Append' }],
            },
        };
        const onChange = vi.fn();
        const { rerender } = render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders' },
                    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'append' },
                    fieldMappings: [],
                    partitions: [],
                }}
                onChange={onChange}
            />,
        );

        expect(screen.getByText('目标字段 id 尚未配置映射')).toBeTruthy();
        onChange.mockClear();
        metadata = {
            ...metadata,
            sourceMetadata: { columns: [{ name: 'id' }] },
        };
        rerender(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders' },
                    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'append' },
                    fieldMappings: [],
                    partitions: [],
                }}
                onChange={onChange}
            />,
        );

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
                fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
            }));
        });
    });

    it('rebuilds rendered target mappings when the target table changes', async () => {
        metadata = {
            ...metadata,
            targetTables: ['dwd_orders', 'dwd_payments'],
            sourceMetadata: { columns: [{ name: 'id' }, { name: 'payment_id' }] },
            targetMetadata: {
                columns: [{ name: 'id' }],
                partitionColumns: [],
                partitioned: false,
                writeModes: [{ value: 'append', label: 'Append' }],
            },
        };
        const onChange = vi.fn();
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders' },
                    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'append' },
                    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
                    partitions: [],
                }}
                onChange={onChange}
            />,
        );

        metadata = {
            ...metadata,
            targetMetadata: {
                columns: [{ name: 'payment_id' }],
                partitionColumns: [],
                partitioned: false,
                writeModes: [{ value: 'append', label: 'Append' }],
            },
        };
        fireEvent.change(screen.getAllByLabelText('表')[1], { target: { value: 'dwd_payments' } });

        await waitFor(() => {
            expect(screen.getAllByText('payment_id').length).toBeGreaterThan(0);
            expect(screen.queryByText('目标字段 payment_id 尚未配置映射')).toBeNull();
        });
        expect(screen.queryByText('目标字段 id 尚未配置映射')).toBeNull();
    });

    it('does not emit overwrite_table for partitioned Hive metadata before write mode reconciliation', async () => {
        metadata = {
            ...metadata,
            targetMetadata: {
                columns: [{ name: 'id' }],
                partitionColumns: [{ name: 'dayno' }],
                partitioned: true,
                writeModes: [
                    { value: 'append', label: 'Append' },
                    { value: 'overwrite_table', label: 'Overwrite table' },
                    { value: 'overwrite_partition', label: 'Overwrite partition' },
                ],
            },
        };
        const onChange = vi.fn();

        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders' },
                    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'overwrite_table' },
                    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
                    partitions: [{ target: 'dayno', kind: 'static_value', value: '20260720' }],
                }}
                onChange={onChange}
            />,
        );

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
                target: expect.objectContaining({ writeMode: 'append' }),
            }));
        });
        expect(onChange.mock.calls).not.toEqual(expect.arrayContaining([
            [expect.objectContaining({ target: expect.objectContaining({ writeMode: 'overwrite_table' }) })],
        ]));
    });
});
