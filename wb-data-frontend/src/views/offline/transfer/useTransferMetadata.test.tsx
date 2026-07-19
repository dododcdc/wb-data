import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDataSourcePage } from '../../../api/datasource';
import { getTransferTableMetadata, getTransferTables } from '../../../api/transfer';
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
    getTransferTables: vi.fn(),
    getTransferTableMetadata: vi.fn(),
}));

describe('useTransferMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getDataSourcePage).mockResolvedValue({ records: [], total: 0, size: 200, current: 1, pages: 0 });
        vi.mocked(getTransferTables).mockResolvedValue({ data: [], total: 0, page: 1, size: 200 });
    });

    it('does not expose previous target metadata after the selected target table changes', async () => {
        vi.mocked(getTransferTableMetadata)
            .mockResolvedValueOnce({
                columns: [{ name: 'id', type: 'BIGINT', size: 0, nullable: false, remarks: '', primaryKey: false }],
                partitionColumns: [],
                partitioned: false,
                writeModes: [{ value: 'append', label: 'Append' }],
            })
            .mockImplementationOnce(() => new Promise(() => {}));

        const { result, rerender } = renderHook(
            ({ targetTable }) => useTransferMetadata(1, undefined, undefined, undefined, 2, undefined, targetTable),
            { initialProps: { targetTable: 'dwd_orders' } },
        );

        await waitFor(() => {
            expect(result.current.targetMetadata?.columns[0]?.name).toBe('id');
        });

        rerender({ targetTable: 'dwd_payments' });

        expect(result.current.targetMetadata).toBeNull();
    });

    it('keeps source table options scoped to the latest selected datasource', async () => {
        const firstSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        const secondSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        vi.mocked(getTransferTables)
            .mockReturnValueOnce(firstSourceTables.promise)
            .mockReturnValueOnce(secondSourceTables.promise);

        const { result, rerender } = renderHook(
            ({ sourceDataSourceId }) => useTransferMetadata(1, sourceDataSourceId),
            { initialProps: { sourceDataSourceId: 11 } },
        );

        rerender({ sourceDataSourceId: 12 });
        await act(async () => {
            secondSourceTables.resolve(makeTablePage(['new_source_table']));
        });
        await waitFor(() => {
            expect(result.current.sourceTables).toEqual(['new_source_table']);
        });

        await act(async () => {
            firstSourceTables.resolve(makeTablePage(['old_source_table']));
        });

        expect(result.current.sourceTables).toEqual(['new_source_table']);
    });

    it('clears source table options immediately while the next datasource list is pending', async () => {
        const firstSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        const secondSourceTables = createDeferred<ReturnType<typeof makeTablePage>>();
        vi.mocked(getTransferTables)
            .mockReturnValueOnce(firstSourceTables.promise)
            .mockReturnValueOnce(secondSourceTables.promise);

        const { result, rerender } = renderHook(
            ({ sourceDataSourceId }) => useTransferMetadata(1, sourceDataSourceId),
            { initialProps: { sourceDataSourceId: 11 } },
        );

        await act(async () => {
            firstSourceTables.resolve(makeTablePage(['old_source_table']));
        });
        await waitFor(() => {
            expect(result.current.sourceTables).toEqual(['old_source_table']);
        });

        rerender({ sourceDataSourceId: 12 });

        expect(result.current.sourceTables).toEqual([]);
    });

    it('keeps target table options scoped to the latest selected datasource', async () => {
        const firstTargetTables = createDeferred<ReturnType<typeof makeTablePage>>();
        const secondTargetTables = createDeferred<ReturnType<typeof makeTablePage>>();
        vi.mocked(getTransferTables)
            .mockReturnValueOnce(firstTargetTables.promise)
            .mockReturnValueOnce(secondTargetTables.promise);

        const { result, rerender } = renderHook(
            ({ targetDataSourceId }) => useTransferMetadata(1, undefined, undefined, undefined, targetDataSourceId),
            { initialProps: { targetDataSourceId: 21 } },
        );

        rerender({ targetDataSourceId: 22 });
        await act(async () => {
            secondTargetTables.resolve(makeTablePage(['new_target_table']));
        });
        await waitFor(() => {
            expect(result.current.targetTables).toEqual(['new_target_table']);
        });

        await act(async () => {
            firstTargetTables.resolve(makeTablePage(['old_target_table']));
        });

        expect(result.current.targetTables).toEqual(['new_target_table']);
    });

    it('clears target table options immediately while the next datasource list is pending', async () => {
        const firstTargetTables = createDeferred<ReturnType<typeof makeTablePage>>();
        const secondTargetTables = createDeferred<ReturnType<typeof makeTablePage>>();
        vi.mocked(getTransferTables)
            .mockReturnValueOnce(firstTargetTables.promise)
            .mockReturnValueOnce(secondTargetTables.promise);

        const { result, rerender } = renderHook(
            ({ targetDataSourceId }) => useTransferMetadata(1, undefined, undefined, undefined, targetDataSourceId),
            { initialProps: { targetDataSourceId: 21 } },
        );

        await act(async () => {
            firstTargetTables.resolve(makeTablePage(['old_target_table']));
        });
        await waitFor(() => {
            expect(result.current.targetTables).toEqual(['old_target_table']);
        });

        rerender({ targetDataSourceId: 22 });

        expect(result.current.targetTables).toEqual([]);
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
            ({ sourceTable }) => useTransferMetadata(1, 11, undefined, sourceTable),
            { initialProps: { sourceTable: 'orders_a' } },
        );

        rerender({ sourceTable: 'orders_b' });
        rerender({ sourceTable: 'orders_a' });

        await act(async () => {
            firstSourceA.resolve(makeMetadata('stale_source_a'));
        });

        expect(result.current.sourceMetadata).toBeNull();

        await act(async () => {
            latestSourceA.resolve(makeMetadata('latest_source_a'));
        });
        await waitFor(() => {
            expect(result.current.sourceMetadata?.columns[0]?.name).toBe('latest_source_a');
        });

        await act(async () => {
            sourceB.resolve(makeMetadata('source_b'));
        });

        expect(result.current.sourceMetadata?.columns[0]?.name).toBe('latest_source_a');
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
            ({ targetTable }) => useTransferMetadata(1, undefined, undefined, undefined, 21, undefined, targetTable),
            { initialProps: { targetTable: 'orders_a' } },
        );

        rerender({ targetTable: 'orders_b' });
        rerender({ targetTable: 'orders_a' });

        await act(async () => {
            firstTargetA.resolve(makeMetadata('stale_target_a'));
        });

        expect(result.current.targetMetadata).toBeNull();

        await act(async () => {
            latestTargetA.resolve(makeMetadata('latest_target_a'));
        });
        await waitFor(() => {
            expect(result.current.targetMetadata?.columns[0]?.name).toBe('latest_target_a');
        });

        await act(async () => {
            targetB.resolve(makeMetadata('target_b'));
        });

        expect(result.current.targetMetadata?.columns[0]?.name).toBe('latest_target_a');
    });
});
