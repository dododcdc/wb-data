import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDataSourceById, getDataSourcePage, type DataSource } from '../../../api/datasource';
import {
    getDialectMetadata,
    getMetadataColumns,
    getMetadataDatabases,
    getMetadataTables,
    type ColumnMetadata,
    type DialectMetadata,
} from '../../../api/query';
import {
    DEFAULT_DATASOURCE_STORAGE_KEY,
    LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY,
    LAST_DATASOURCE_STORAGE_KEY,
} from '../storageUtils';
import { useMetadata } from './useMetadata';

vi.mock('../../../api/datasource', async () => {
    const actual = await vi.importActual<typeof import('../../../api/datasource')>('../../../api/datasource');
    return {
        ...actual,
        getDataSourcePage: vi.fn(),
        getDataSourceById: vi.fn(),
    };
});

vi.mock('../../../api/query', async () => {
    const actual = await vi.importActual<typeof import('../../../api/query')>('../../../api/query');
    return {
        ...actual,
        getMetadataDatabases: vi.fn(),
        getMetadataTables: vi.fn(),
        getMetadataColumns: vi.fn(),
        getDialectMetadata: vi.fn(),
    };
});

function makeDataSource(overrides: Partial<DataSource> & { id: number; name: string }): DataSource {
    return {
        type: 'MYSQL',
        description: '',
        host: '127.0.0.1',
        port: 3306,
        databaseName: '',
        username: 'root',
        connectionParams: {},
        status: 'ENABLED',
        owner: 'admin',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

const DEFAULT_DIALECT: DialectMetadata = {
    keywords: ['SELECT', 'FROM'],
    functions: [],
    dataTypes: ['INT', 'VARCHAR'],
};

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    return {
        queryClient,
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
    };
}

describe('useMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        vi.mocked(getDialectMetadata).mockResolvedValue(DEFAULT_DIALECT);
        vi.mocked(getMetadataDatabases).mockResolvedValue([]);
        vi.mocked(getMetadataTables).mockResolvedValue({ data: [], total: 0, page: 1, size: 200 });
        vi.mocked(getMetadataColumns).mockResolvedValue([]);
        vi.mocked(getDataSourceById).mockImplementation(async (id) => makeDataSource({ id, name: `ds-${id}` }));
    });

    it('loads paginated datasources, filters with debounce, and loads next page via loadMoreDataSources', async () => {
        const ds1 = makeDataSource({ id: 1, name: 'analytics_1' });
        const ds2 = makeDataSource({ id: 2, name: 'analytics_2' });
        const ds3 = makeDataSource({ id: 3, name: 'orders_3' });

        vi.mocked(getDataSourcePage).mockImplementation(async ({ page, keyword }) => {
            if (keyword === 'orders') {
                return { records: [ds3], total: 1, size: 50, current: 1, pages: 1 };
            }
            if (page === 1) {
                return { records: [ds1], total: 2, size: 50, current: 1, pages: 2 };
            }
            return { records: [ds2], total: 2, size: 50, current: 2, pages: 2 };
        });

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useMetadata(10), { wrapper });

        await waitFor(() => {
            expect(result.current.dataSources.map((d) => d.id)).toEqual([1]);
        });
        expect(result.current.dsHasMore).toBe(true);

        act(() => {
            result.current.loadMoreDataSources();
        });

        await waitFor(() => {
            expect(result.current.dataSources.map((d) => d.id)).toEqual([1, 2]);
        });
        expect(result.current.dsHasMore).toBe(false);

        act(() => {
            result.current.setDsKeyword('orders');
        });

        await waitFor(() => {
            expect(result.current.dataSources.map((d) => d.id)).toEqual([3]);
        }, { timeout: 2000 });
    });

    it('auto-selects the sole datasource when no stored preference exists', async () => {
        const soleDs = makeDataSource({ id: 7, name: 'sole_mysql', databaseName: 'warehouse' });
        vi.mocked(getDataSourcePage).mockResolvedValue({
            records: [soleDs],
            total: 1,
            size: 50,
            current: 1,
            pages: 1,
        });
        vi.mocked(getMetadataDatabases).mockResolvedValue(['information_schema', 'warehouse']);

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useMetadata(10), { wrapper });

        await waitFor(() => {
            expect(result.current.selectedDsId).toBe('7');
            expect(result.current.selectedDb).toBe('warehouse');
        });
        expect(result.current.dialectMetadata).toEqual(DEFAULT_DIALECT);
    });

    it('resolves preferred stored datasource by id when absent from page 1 and clears stale ids on error', async () => {
        const ds1 = makeDataSource({ id: 1, name: 'first' });
        const ds2 = makeDataSource({ id: 2, name: 'second' });
        const ds99 = makeDataSource({ id: 99, name: 'preferred_remote', databaseName: 'bi_db' });

        localStorage.setItem(DEFAULT_DATASOURCE_STORAGE_KEY, '99');
        vi.mocked(getDataSourcePage).mockResolvedValue({
            records: [ds1, ds2],
            total: 2,
            size: 50,
            current: 1,
            pages: 1,
        });
        vi.mocked(getDataSourceById).mockResolvedValue(ds99);
        vi.mocked(getMetadataDatabases).mockResolvedValue(['bi_db', 'public']);

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useMetadata(10), { wrapper });

        await waitFor(() => {
            expect(result.current.selectedDsId).toBe('99');
            expect(result.current.selectedDb).toBe('bi_db');
        });
        expect(result.current.dataSources[0]?.id).toBe(99);

        // Now simulate stale/missing stored ID
        localStorage.clear();
        localStorage.setItem(DEFAULT_DATASOURCE_STORAGE_KEY, '404');
        localStorage.setItem(LAST_DATASOURCE_STORAGE_KEY, '404');
        vi.mocked(getDataSourceById).mockRejectedValueOnce(new Error('404 Not Found'));

        const { wrapper: wrapper2 } = createWrapper();
        renderHook(() => useMetadata(10), { wrapper: wrapper2 });

        await waitFor(() => {
            expect(localStorage.getItem(DEFAULT_DATASOURCE_STORAGE_KEY)).toBeNull();
            expect(localStorage.getItem(LAST_DATASOURCE_STORAGE_KEY)).toBeNull();
        });
    });

    it('ignores sticky remembered database on datasource switch even when database list comes from React Query cache', async () => {
        const dsA = makeDataSource({ id: 1, name: 'ds_a', databaseName: 'db_a' });
        const dsB = makeDataSource({ id: 2, name: 'ds_b', databaseName: 'db_b_default' });

        vi.mocked(getDataSourcePage).mockResolvedValue({
            records: [dsA, dsB],
            total: 2,
            size: 50,
            current: 1,
            pages: 1,
        });
        vi.mocked(getMetadataDatabases).mockImplementation(async (dsId) => {
            if (dsId === 1) return ['db_a', 'shared_schema'];
            return ['shared_schema', 'db_b_default'];
        });

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useMetadata(10), { wrapper });

        await waitFor(() => {
            expect(result.current.dataSources).toHaveLength(2);
        });

        // Visit dsA and pick db_a
        act(() => {
            result.current.applySelectedDataSource('1', dsA);
        });
        await waitFor(() => expect(result.current.selectedDb).toBe('db_a'));

        // Switch to dsB and remember shared_schema
        act(() => {
            result.current.applySelectedDataSource('2', dsB);
        });
        await waitFor(() => expect(result.current.selectedDb).toBe('db_b_default'));

        // Manually seed remembered memory for dsB (simulating prior manual choice)
        act(() => {
            result.current.setSelectedDb('shared_schema');
        });
        await waitFor(() => {
            expect(JSON.parse(localStorage.getItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY) || '{}')['2']).toBe('shared_schema');
        });

        // Switch back to dsA
        act(() => {
            result.current.applySelectedDataSource('1', dsA);
        });
        await waitFor(() => expect(result.current.selectedDb).toBe('db_a'));

        // Switch to dsB again (databases for dsB are already cached in React Query!)
        act(() => {
            result.current.applySelectedDataSource('2', dsB);
        });
        await waitFor(() => {
            expect(result.current.selectedDsId).toBe('2');
            expect(result.current.selectedDb).toBe('db_b_default');
        });
        expect(JSON.parse(localStorage.getItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY) || '{}')['2']).toBe('db_b_default');
    });

    it('never leaks previous datasource selectedDb into new datasource lastDatabaseByDs storage', async () => {
        const dsA = makeDataSource({ id: 1, name: 'ds_a', databaseName: 'only_a' });
        const dsB = makeDataSource({ id: 2, name: 'ds_b', databaseName: '' });

        let resolveDbB!: (dbs: string[]) => void;
        vi.mocked(getDataSourcePage).mockResolvedValue({
            records: [dsA, dsB],
            total: 2,
            size: 50,
            current: 1,
            pages: 1,
        });
        vi.mocked(getMetadataDatabases).mockImplementation((dsId) => {
            if (dsId === 1) return Promise.resolve(['only_a']);
            return new Promise<string[]>((resolve) => { resolveDbB = resolve; });
        });

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useMetadata(10), { wrapper });
        await waitFor(() => expect(result.current.dataSources).toHaveLength(2));

        act(() => {
            result.current.applySelectedDataSource('1', dsA);
        });
        await waitFor(() => expect(result.current.selectedDb).toBe('only_a'));

        act(() => {
            result.current.applySelectedDataSource('2', dsB);
        });

        expect(result.current.selectedDsId).toBe('2');
        expect(result.current.selectedDb).toBe('');
        const storedMidSwitch = JSON.parse(localStorage.getItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY) || '{}');
        expect(storedMidSwitch['2']).toBeUndefined();

        await waitFor(() => expect(resolveDbB).toBeTypeOf('function'));

        act(() => {
            resolveDbB(['target_first']);
        });
        await waitFor(() => expect(result.current.selectedDb).toBe('target_first'));

        const storedAfter = JSON.parse(localStorage.getItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY) || '{}');
        expect(storedAfter['1']).toBe('only_a');
        expect(storedAfter['2']).toBe('target_first');
    });

    it('loads infinite tables, filters by committed keyword, and fetches next page on scroll near bottom', async () => {
        const ds1 = makeDataSource({ id: 1, name: 'mysql', databaseName: 'sales' });
        vi.mocked(getDataSourcePage).mockResolvedValue({
            records: [ds1],
            total: 1,
            size: 50,
            current: 1,
            pages: 1,
        });
        vi.mocked(getMetadataDatabases).mockResolvedValue(['sales']);
        vi.mocked(getMetadataTables).mockImplementation(async (_dsId, _db, keyword, page) => {
            if (keyword === 'fact') {
                return {
                    data: [{ name: 'fact_orders', type: 'TABLE', remarks: '' }],
                    total: 1,
                    page: 1,
                    size: 200,
                };
            }
            if (page === 1) {
                return {
                    data: [{ name: 't1', type: 'TABLE', remarks: '' }],
                    total: 2,
                    page: 1,
                    size: 200,
                };
            }
            return {
                data: [{ name: 't2', type: 'TABLE', remarks: '' }],
                total: 2,
                page: 2,
                size: 200,
            };
        });

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useMetadata(10), { wrapper });

        await waitFor(() => {
            expect(result.current.tables.map((t) => t.name)).toEqual(['t1']);
        });
        expect(result.current.tableHasMore).toBe(true);
        expect(result.current.tableTotal).toBe(2);

        const scrollEl = { scrollTop: 950, scrollHeight: 1000, clientHeight: 100 } as HTMLDivElement;
        act(() => {
            result.current.handleTableScrollRef(scrollEl);
        });
        act(() => {
            result.current.handleTableScroll();
        });

        await waitFor(() => {
            expect(result.current.tables.map((t) => t.name)).toEqual(['t1', 't2']);
        });
        expect(result.current.tableHasMore).toBe(false);

        act(() => {
            result.current.setTableKeywordCommitted('fact');
        });

        await waitFor(() => {
            expect(result.current.tables.map((t) => t.name)).toEqual(['fact_orders']);
        }, { timeout: 2000 });
    });

    it('deduplicates concurrent loadColumns requests, serves cached columns, and ignores stale DB responses', async () => {
        const ds1 = makeDataSource({ id: 1, name: 'mysql', databaseName: 'db_1' });
        vi.mocked(getDataSourcePage).mockResolvedValue({
            records: [ds1],
            total: 1,
            size: 50,
            current: 1,
            pages: 1,
        });
        vi.mocked(getMetadataDatabases).mockResolvedValue(['db_1', 'db_2']);

        const colsDb1: ColumnMetadata[] = [
            { name: 'id', type: 'BIGINT', size: 0, nullable: false, remarks: '', primaryKey: true },
        ];
        const colsOther: ColumnMetadata[] = [
            { name: 'stale_col', type: 'VARCHAR', size: 64, nullable: true, remarks: '', primaryKey: false },
        ];

        let resolveSlowColumns!: (cols: ColumnMetadata[]) => void;
        vi.mocked(getMetadataColumns).mockImplementation((_dsId, dbName) => {
            if (dbName === 'db_1') {
                return Promise.resolve(colsDb1);
            }
            return new Promise<ColumnMetadata[]>((resolve) => {
                resolveSlowColumns = resolve;
            });
        });

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useMetadata(10), { wrapper });

        await waitFor(() => expect(result.current.selectedDb).toBe('db_1'));

        // Concurrent calls for same (dsId, dbName, table) deduplicate to 1 API call
        let resA: ColumnMetadata[] | null = null;
        let resB: ColumnMetadata[] | null = null;
        await act(async () => {
            [resA, resB] = await Promise.all([
                result.current.loadColumns(1, 'db_1', 'orders'),
                result.current.loadColumns(1, 'db_1', 'orders'),
            ]);
        });
        expect(resA).toEqual(colsDb1);
        expect(resB).toEqual(colsDb1);
        expect(getMetadataColumns).toHaveBeenCalledTimes(1);
        expect(result.current.columnCache.get('orders')).toEqual(colsDb1);

        // Cached call does not trigger another fetch
        await act(async () => {
            const cached = await result.current.loadColumns(1, 'db_1', 'orders');
            expect(cached).toEqual(colsDb1);
        });
        expect(getMetadataColumns).toHaveBeenCalledTimes(1);

        // Stale response after activeDb changes does not pollute columnCache of db_2
        let pendingOtherPromise!: Promise<ColumnMetadata[] | null>;
        act(() => {
            pendingOtherPromise = result.current.loadColumns(1, 'other_db', 'slow_tbl');
        });
        act(() => {
            result.current.setSelectedDb('db_2');
        });
        await waitFor(() => expect(result.current.selectedDb).toBe('db_2'));

        await act(async () => {
            resolveSlowColumns(colsOther);
            await pendingOtherPromise;
        });

        expect(result.current.columnCache.has('slow_tbl')).toBe(false);
    });
});
