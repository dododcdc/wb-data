import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
}));

vi.mock('../utils/request', () => ({
    default: {
        get: getMock,
        post: postMock,
        defaults: { baseURL: '' },
    },
}));

import { executeQuery, getMetadataColumns, getMetadataTables } from './query';

describe('query api', () => {
    beforeEach(() => {
        getMock.mockReset();
        postMock.mockReset();
    });

    it('encodes special characters in databaseName and tableName for metadata requests', async () => {
        getMock.mockResolvedValue({});

        await getMetadataTables(7, 'my/db#1 name', 'ord', 1, 50);
        expect(getMock).toHaveBeenCalledWith(
            '/api/v1/query/metadata/7/my%2Fdb%231%20name/tables?keyword=ord&page=1&size=50',
        );

        await getMetadataColumns(7, 'my/db#1 name', 't/a b#1');
        expect(getMock).toHaveBeenCalledWith(
            '/api/v1/query/metadata/7/my%2Fdb%231%20name/tables/t%2Fa%20b%231/columns',
        );
    });

    it('configures executeQuery with a 65 second timeout above the backend JDBC timeout', async () => {
        postMock.mockResolvedValue({ columns: [], rows: [] });

        await executeQuery(7, 'SELECT 1', 'analytics');

        expect(postMock).toHaveBeenCalledWith(
            '/api/v1/query/execute/7',
            { sql: 'SELECT 1', database: 'analytics' },
            {
                timeout: 65_000,
                headers: {
                    'Content-Type': 'application/json',
                },
            },
        );
    });
});
