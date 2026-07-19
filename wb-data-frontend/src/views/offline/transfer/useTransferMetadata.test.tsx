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
});
