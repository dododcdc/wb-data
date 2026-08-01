import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DataSource } from '../../../api/datasource';
import type { TransferTableMetadataResponse } from '../../../api/transfer';
import { TransferNodeDialog } from './TransferNodeDialog';
import type { TransferAsyncResource } from './useTransferMetadata';
import type { TransferConfig } from './transferTypes';

interface EndpointMetadata {
    databases: TransferAsyncResource<string[]>;
    tables: TransferAsyncResource<string[]>;
    metadata: TransferAsyncResource<TransferTableMetadataResponse | null>;
}

interface MockTransferMetadata {
    dataSources: DataSource[];
    source: EndpointMetadata;
    target: EndpointMetadata;
}

const sourceMetadata: TransferTableMetadataResponse = {
    columns: [{ name: 'id', type: 'BIGINT', size: 0, nullable: false, remarks: '', primaryKey: false }],
    partitionColumns: [],
    partitioned: false,
    writeModes: [{ value: 'append', label: 'Append' }],
};

const targetMetadata: TransferTableMetadataResponse = {
    columns: [{ name: 'id', type: 'BIGINT', size: 0, nullable: false, remarks: '', primaryKey: false }],
    partitionColumns: [{ name: 'dayno', type: 'STRING', remarks: '' }],
    partitioned: true,
    writeModes: [
        { value: 'append', label: 'Append' },
        { value: 'overwrite_partition', label: 'Overwrite partition' },
    ],
};

const dataSources: DataSource[] = [
    {
        id: 1,
        name: 'mysql_source',
        type: 'MYSQL',
        description: '',
        databaseName: 'transfer_demo',
        connectionParams: {},
        status: 'ENABLED',
        owner: 'admin',
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 2,
        name: 'hive_target',
        type: 'HIVE',
        description: '',
        databaseName: 'default',
        connectionParams: {},
        status: 'ENABLED',
        owner: 'admin',
        createdAt: '',
        updatedAt: '',
    },
];

function resource<T>(data: T, overrides: Partial<TransferAsyncResource<T>> = {}): TransferAsyncResource<T> {
    return { data, loading: false, error: null, retry: vi.fn(), ...overrides };
}

function makeMetadata(): MockTransferMetadata {
    return {
        dataSources,
        source: {
            databases: resource(['transfer_demo', 'archive']),
            tables: resource(['orders']),
            metadata: resource(sourceMetadata),
        },
        target: {
            databases: resource(['default']),
            tables: resource(['dwd_orders', 'dwd_payments']),
            metadata: resource(targetMetadata),
        },
    };
}

let metadata = makeMetadata();

vi.mock('./useTransferMetadata', () => ({
    useTransferMetadata: () => metadata,
}));

const validTransfer: TransferConfig = {
    source: {
        dataSourceId: 1,
        dataSourceType: 'MYSQL',
        database: 'transfer_demo',
        table: 'orders',
        where: "status = 'ACTIVE'",
    },
    target: {
        dataSourceId: 2,
        dataSourceType: 'HIVE',
        database: 'default',
        table: 'dwd_orders',
        writeMode: 'append',
    },
    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
    partitions: [{ target: 'dayno', kind: 'static_value', value: '20260719' }],
};

afterEach(() => {
    cleanup();
    metadata = makeMetadata();
});

describe('TransferNodeDialog', () => {
    it('renders database controls before tables and keeps Hive partitions separate', () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getAllByLabelText('数据库')).toHaveLength(2);
        expect(screen.getAllByLabelText('表')).toHaveLength(2);
        expect(screen.getByDisplayValue("status = 'ACTIVE'")).toBeTruthy();
        expect(screen.getByText('Hive 分区字段')).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'Overwrite table' })).toBeNull();
    });

    it('automatically selects configured default databases', async () => {
        const onDraftChange = vi.fn();
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: '' },
                    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: '', writeMode: 'append' },
                    fieldMappings: [],
                    partitions: [],
                }}
                onChange={vi.fn()}
                onDraftChange={onDraftChange}
            />,
        );

        await waitFor(() => {
            expect(onDraftChange).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    source: expect.objectContaining({ database: 'transfer_demo' }),
                    target: expect.objectContaining({ database: 'default' }),
                }),
                expect.any(Object),
            );
        });
    });

    it('preserves an unavailable saved database and requires replacement', async () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    source: { ...validTransfer.source, database: 'removed' },
                }}
                onChange={vi.fn()}
            />,
        );

        expect(await screen.findByRole('option', { name: 'removed（不可用）' })).toBeTruthy();
        expect(screen.getByText('已保存的来源数据库不可用，请重新选择')).toBeTruthy();
    });

    it('clears the table and mappings when a database changes', async () => {
        const onDraftChange = vi.fn();
        render(
            <TransferNodeDialog
                groupId={1}
                value={validTransfer}
                onChange={vi.fn()}
                onDraftChange={onDraftChange}
            />,
        );

        fireEvent.change(screen.getAllByLabelText('数据库')[0], { target: { value: 'archive' } });

        await waitFor(() => {
            expect(onDraftChange).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    source: expect.objectContaining({ database: 'archive', table: '' }),
                    fieldMappings: [],
                    partitions: [],
                }),
                expect.any(Object),
            );
        });
    });

    it('disables tables and retries a failed database request', () => {
        const retry = vi.fn();
        metadata = {
            ...metadata,
            source: {
                ...metadata.source,
                databases: resource([], { error: '数据库加载失败', retry }),
                tables: resource([]),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getAllByLabelText('表')[0]).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByRole('button', { name: '重试来源数据库' }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('preserves the database and retries a failed table request', () => {
        const retry = vi.fn();
        metadata = {
            ...metadata,
            source: {
                ...metadata.source,
                tables: resource([], { error: '表加载失败', retry }),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getAllByLabelText('数据库')[0]).toHaveProperty('value', 'transfer_demo');
        fireEvent.click(screen.getByRole('button', { name: '重试来源表' }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('shows metadata loading and retries the side that failed', () => {
        const retry = vi.fn();
        metadata = {
            ...metadata,
            source: {
                ...metadata.source,
                metadata: resource(null, { loading: true }),
            },
            target: {
                ...metadata.target,
                metadata: resource(null, { error: '字段元数据加载失败', retry }),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getByText('正在加载来源字段')).toBeTruthy();
        expect(screen.getByText('目标字段元数据加载失败')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '重试目标字段' }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('renders an explicit empty state when the target has no transferable columns', () => {
        metadata = {
            ...metadata,
            target: {
                ...metadata.target,
                metadata: resource({ ...targetMetadata, columns: [], partitionColumns: [], partitioned: false }),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getByText('目标表没有可传输字段')).toBeTruthy();
    });

    it('renders an unmapped target field beside its row and blocks valid output', async () => {
        metadata = {
            ...metadata,
            target: {
                ...metadata.target,
                metadata: resource({
                    ...targetMetadata,
                    columns: [
                        ...targetMetadata.columns,
                        { name: 'amount', type: 'DECIMAL', size: 0, nullable: true, remarks: '', primaryKey: false },
                    ],
                }),
            },
        };
        const onChange = vi.fn();
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={onChange} />);

        await waitFor(() => {
            expect(screen.getAllByText('目标字段 amount 尚未配置映射').length).toBeGreaterThan(0);
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('defaults same-name mappings when source metadata arrives after target metadata', async () => {
        metadata = {
            ...metadata,
            source: { ...metadata.source, metadata: resource(null, { loading: true }) },
            target: {
                ...metadata.target,
                metadata: resource({ ...targetMetadata, partitioned: false, partitionColumns: [] }),
            },
        };
        const onChange = vi.fn();
        const { rerender } = render(
            <TransferNodeDialog
                groupId={1}
                value={{ ...validTransfer, fieldMappings: [], partitions: [] }}
                onChange={onChange}
            />,
        );

        expect(screen.getByText('正在加载来源字段')).toBeTruthy();
        onChange.mockClear();
        metadata = {
            ...metadata,
            source: { ...metadata.source, metadata: resource(sourceMetadata) },
        };
        rerender(
            <TransferNodeDialog
                groupId={1}
                value={{ ...validTransfer, fieldMappings: [], partitions: [] }}
                onChange={onChange}
            />,
        );

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
                fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
            }));
        });
    });

    it('does not emit overwrite_table for partitioned Hive metadata before reconciliation', async () => {
        metadata = {
            ...metadata,
            target: {
                ...metadata.target,
                metadata: resource({
                    ...targetMetadata,
                    writeModes: [
                        { value: 'append', label: 'Append' },
                        { value: 'overwrite_table', label: 'Overwrite table' },
                        { value: 'overwrite_partition', label: 'Overwrite partition' },
                    ],
                }),
            },
        };
        const onChange = vi.fn();

        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    target: { ...validTransfer.target, writeMode: 'overwrite_table' },
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
