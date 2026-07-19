import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDataSourcePage } from '../../../api/datasource';
import { getTransferTableMetadata, getTransferTables } from '../../../api/transfer';
import { useTransferMetadata } from './useTransferMetadata';

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
});
