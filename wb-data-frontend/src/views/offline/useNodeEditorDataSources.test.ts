import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/datasource', async () => {
    const actual = await vi.importActual<typeof import('../../api/datasource')>('../../api/datasource');
    return {
        ...actual,
        getDataSourceById: vi.fn(),
        getDataSourcePage: vi.fn(),
    };
});

describe('useNodeEditorDataSources preload cache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reuses prefetched first pages for SQL and HiveSQL node editors', async () => {
        const datasourceApi = await import('../../api/datasource');
        const { prefetchNodeEditorDataSources } = await import('./useNodeEditorDataSources');
        vi.mocked(datasourceApi.getDataSourcePage).mockResolvedValue({
            records: [],
            total: 0,
            size: 50,
            current: 1,
            pages: 0,
        });

        await prefetchNodeEditorDataSources(1);
        await prefetchNodeEditorDataSources(1);

        expect(datasourceApi.getDataSourcePage).toHaveBeenCalledTimes(2);
        expect(datasourceApi.getDataSourcePage).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 1,
            page: 1,
            keyword: '',
            status: 'ENABLED',
            type: 'MYSQL,POSTGRESQL,STARROCKS',
        }));
        expect(datasourceApi.getDataSourcePage).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 1,
            page: 1,
            keyword: '',
            status: 'ENABLED',
            type: 'HIVE',
        }));
    });
});
