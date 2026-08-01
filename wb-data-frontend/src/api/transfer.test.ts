import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => ({
    get: vi.fn(),
}));

vi.mock('../utils/request', () => ({
    default: requestMock,
}));

import { getTransferDatabases, getTransferTableMetadata, getTransferTables } from './transfer';

describe('transfer metadata API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses group-scoped paths and forwards table query parameters', async () => {
        await getTransferDatabases(4, 11676);
        await getTransferTables(4, 11676, {
            databaseName: 'warehouse',
            keyword: 'order',
            page: 2,
            size: 50,
        });
        await getTransferTableMetadata(4, 11676, 'warehouse', 'daily_orders');

        expect(requestMock.get).toHaveBeenNthCalledWith(
            1,
            '/api/v1/groups/4/offline/transfer/datasources/11676/databases',
        );
        expect(requestMock.get).toHaveBeenNthCalledWith(
            2,
            '/api/v1/groups/4/offline/transfer/datasources/11676/tables',
            { params: { databaseName: 'warehouse', keyword: 'order', page: 2, size: 50 } },
        );
        expect(requestMock.get).toHaveBeenNthCalledWith(
            3,
            '/api/v1/groups/4/offline/transfer/datasources/11676/tables/daily_orders/metadata',
            { params: { databaseName: 'warehouse' } },
        );
    });
});
