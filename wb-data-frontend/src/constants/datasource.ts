export const DATASOURCE_LIST_DEFAULT_PAGE_SIZE = 10;
export const DATASOURCE_SELECTOR_PAGE_SIZE = 50;

export function buildDataSourcePageQueryKey(params: {
    currentPage: number;
    pageSize: number;
    keyword: string;
    groupId?: number;
}) {
    return ['dataSources', {
        currentPage: params.currentPage,
        pageSize: params.pageSize,
        keyword: params.keyword,
        groupId: params.groupId,
    }] as const;
}
