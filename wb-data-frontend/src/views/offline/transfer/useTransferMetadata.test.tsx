import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDataSourcePage } from '../../../api/datasource';
import { getTransferDatabases, getTransferTableMetadata, getTransferTables } from '../../../api/transfer';
import { useTransferMetadata } from './useTransferMetadata';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeTablePage(names: string[]) {
    return {
        data: names.map((name) => ({ name, type: 'TABLE', remarks: '' })),
        total: names.length,
        page: 1,
        size: 200,
    };
}

function makeMetadata(columnName: string) {
    return {
        columns: [{ name: columnName, type: 'BIGINT', size: 0, nullable: false, remarks: '', primaryKey: false }],
        partitionColumns: [],
        partitioned: false,
        writeModes: [{ value: 'append' as const, label: 'Append' }],
    };
}

vi.mock('../../../api/datasource', () => ({
    getDataSourcePage: vi.fn(),
}));

vi.mock('../../../api/transfer', () => ({
    getTransferDatabases: vi.fn(),
    getTransferTables: vi.fn(),
    getTransferTableMetadata: vi.fn(),
}));

describe('useTransferMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getDataSourcePage).mockResolvedValue({ records: [], total: 0, size: 200, current: 1, pages: 0 });
        vi.mocked(getTransferDatabases).mockResolvedValue([]);
        vi.mocked(getTransferTables).mockResolvedValue(makeTablePage([]));
    });

    it('loads databases but waits for a database before loading tables', async () => {
        vi.mocked(getTransferDatabases).mockResolvedValue(['transfer_demo', 'archive']);

        const { result } = renderHook(() => useTransferMetadata(1, 11));

        await waitFor(() => {
            expect(result.current.source.databases.data).toEqual(['transfer_demo', 'archive']);
        });
        expect(getTransferDatabases).toHaveBeenCalledWith(1, 11);
        expect(getTransferTables).not.toHaveBeenCalled();
    });

    it('passes the selected database when loading tables', async () => {
        renderHook(() => useTransferMetadata(1, 11, 'transfer_demo'));

        await waitFor(() => {
            expect(getTransferTables).toHaveBeenCalledWith(1, 11, {
                databaseName: 'transfer_demo',
                page: 1,
                size: 200,
            });
        });
    });

    it('does not expose previous target metadata after the selected target table changes', async () => {
        vi.mocked(getTransferTableMetadata)
            .mockResolvedValueOnce(makeMetadata('id'))
            .mockImplementationOnce(() => new Promise(() => {}));

        const { result, rerender } = renderHook(
            ({ targetTable }) => useTransferMetadata(1, undefined, undefined, undefined, 2, 'default', targetTable),
            { initialProps: { targetTable: 'dwd_orders' } },
        );

        await waitFor(() => {
            expect(result.current.target.metadata.data?.columns[0]?.name).toBe('id');
        });

        rerender({ targetTable: 'dwd_payments' });

        expect(result.current.target.metadata.data).toBeNull();
        expect(result.current.target.metadata.loading).toBe(true);
    });

    it('keeps source table options scoped to the latest selected datasource', async () => {
        const firstSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        const secondSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        vi.mocked(getTransferTables)
            .mockReturnValueOnce(firstSourceTables.promise)
            .mockReturnValueOnce(secondSourceTables.promise);

        const { result, rerender } = renderHook(
            ({ sourceDataSourceId }) => useTransferMetadata(1, sourceDataSourceId, 'app'),
            { initialProps: { sourceDataSourceId: 11 } },
        );

        rerender({ sourceDataSourceId: 12 });
        await act(async () => {
            secondSourceTables.resolve(makeTablePage(['new_source_table']));
        });
        await waitFor(() => {
            expect(result.current.source.tables.data).toEqual(['new_source_table']);
        });

        await act(async () => {
            firstSourceTables.resolve(makeTablePage(['old_source_table']));
        });

        expect(result.current.source.tables.data).toEqual(['new_source_table']);
    });

    it('clears source table options immediately while the next datasource list is pending', async () => {
        const firstSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        const secondSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        vi.mocked(getTransferTables)
            .mockReturnValueOnce(firstSourceTables.promise)
            .mockReturnValueOnce(secondSourceTables.promise);

        const { result, rerender } = renderHook(
            ({ sourceDataSourceId }) => useTransferMetadata(1, sourceDataSourceId, 'app'),
            { initialProps: { sourceDataSourceId: 11 } },
        );

        await act(async () => {
            firstSourceTables.resolve(makeTablePage(['old_source_table']));
        });
        await waitFor(() => {
            expect(result.current.source.tables.data).toEqual(['old_source_table']);
        });

        rerender({ sourceDataSourceId: 12 });

        expect(result.current.source.tables.data).toEqual([]);
        expect(result.current.source.tables.loading).toBe(true);
    });

    it('exposes a database error and retries the request', async () => {
        vi.mocked(getTransferDatabases)
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(['default']);

        const { result } = renderHook(() => useTransferMetadata(1, 11));

        await waitFor(() => {
            expect(result.current.source.databases.error).toBe('数据库加载失败');
        });

        act(() => result.current.source.databases.retry());

        await waitFor(() => {
            expect(result.current.source.databases.data).toEqual(['default']);
        });
        expect(getTransferDatabases).toHaveBeenCalledTimes(2);
    });

    it('exposes a table error and retries with the selected database', async () => {
        vi.mocked(getTransferTables)
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(makeTablePage(['orders']));

        const { result } = renderHook(() => useTransferMetadata(1, 11, 'transfer_demo'));

        await waitFor(() => {
            expect(result.current.source.tables.error).toBe('表加载失败');
        });

        act(() => result.current.source.tables.retry());

        await waitFor(() => {
            expect(result.current.source.tables.data).toEqual(['orders']);
        });
        expect(getTransferTables).toHaveBeenLastCalledWith(1, 11, {
            databaseName: 'transfer_demo',
            page: 1,
            size: 200,
        });
    });

    it('ignores stale source metadata from an earlier matching selection after A-B-A changes', async () => {
        const firstSourceA = createDeferred<ReturnType<typeof makeMetadata>>();
        const sourceB = createDeferred<ReturnType<typeof makeMetadata>>();
        const latestSourceA = createDeferred<ReturnType<typeof makeMetadata>>();
        vi.mocked(getTransferTableMetadata)
            .mockReturnValueOnce(firstSourceA.promise)
            .mockReturnValueOnce(sourceB.promise)
            .mockReturnValueOnce(latestSourceA.promise);

        const { result, rerender } = renderHook(
            ({ sourceTable }) => useTransferMetadata(1, 11, 'app', sourceTable),
            { initialProps: { sourceTable: 'orders_a' } },
        );

        rerender({ sourceTable: 'orders_b' });
        rerender({ sourceTable: 'orders_a' });

        await act(async () => {
            firstSourceA.resolve(makeMetadata('stale_source_a'));
        });

        expect(result.current.source.metadata.data).toBeNull();

        await act(async () => {
            latestSourceA.resolve(makeMetadata('latest_source_a'));
        });
        await waitFor(() => {
            expect(result.current.source.metadata.data?.columns[0]?.name).toBe('latest_source_a');
        });

        await act(async () => {
            sourceB.resolve(makeMetadata('source_b'));
        });

        expect(result.current.source.metadata.data?.columns[0]?.name).toBe('latest_source_a');
    });

    it('ignores stale target metadata from an earlier matching selection after A-B-A changes', async () => {
        const firstTargetA = createDeferred<ReturnType<typeof makeMetadata>>();
        const targetB = createDeferred<ReturnType<typeof makeMetadata>>();
        const latestTargetA = createDeferred<ReturnType<typeof makeMetadata>>();
        vi.mocked(getTransferTableMetadata)
            .mockReturnValueOnce(firstTargetA.promise)
            .mockReturnValueOnce(targetB.promise)
            .mockReturnValueOnce(latestTargetA.promise);

        const { result, rerender } = renderHook(
            ({ targetTable }) => useTransferMetadata(1, undefined, undefined, undefined, 21, 'warehouse', targetTable),
            { initialProps: { targetTable: 'orders_a' } },
        );

        rerender({ targetTable: 'orders_b' });
        rerender({ targetTable: 'orders_a' });

        await act(async () => {
            firstTargetA.resolve(makeMetadata('stale_target_a'));
        });

        expect(result.current.target.metadata.data).toBeNull();

        await act(async () => {
            latestTargetA.resolve(makeMetadata('latest_target_a'));
        });
        await waitFor(() => {
            expect(result.current.target.metadata.data?.columns[0]?.name).toBe('latest_target_a');
        });

        await act(async () => {
            targetB.resolve(makeMetadata('target_b'));
        });

        expect(result.current.target.metadata.data?.columns[0]?.name).toBe('latest_target_a');
    });
});
