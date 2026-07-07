import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from './datasource';

const requestMock = vi.hoisted(() => ({
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
}));

vi.mock('../utils/request', () => ({
    default: requestMock,
}));

import {
    deleteDataSource,
    testExistingConnection,
    updateDataSource,
    updateDataSourceStatus,
} from './datasource';

describe('datasource API group scoping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the group-scoped route when updating an existing data source', async () => {
        const payload: Partial<DataSource> = {
            host: 'wb-data-hiveserver2',
            port: 10000,
        };

        await updateDataSource(11676, payload, 4);

        expect(requestMock.put).toHaveBeenCalledWith(
            '/api/v1/groups/4/datasources/11676',
            payload,
        );
    });

    it('uses group-scoped routes for existing data source actions', async () => {
        await deleteDataSource(11676, 4);
        await updateDataSourceStatus(11676, 'DISABLED', 4);
        await testExistingConnection(11676, 4);

        expect(requestMock.delete).toHaveBeenCalledWith(
            '/api/v1/groups/4/datasources/11676',
        );
        expect(requestMock.patch).toHaveBeenCalledWith(
            '/api/v1/groups/4/datasources/11676/status',
            { status: 'DISABLED' },
        );
        expect(requestMock.post).toHaveBeenCalledWith(
            '/api/v1/groups/4/datasources/11676/test',
        );
    });
});
