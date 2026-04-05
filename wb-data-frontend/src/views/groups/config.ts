export { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE, parsePageParam, parsePageSizeParam, formatTimestamp } from '../../utils/pagination';

export function buildGroupPageQueryKey(params: {
    currentPage: number;
    pageSize: number;
    keyword: string;
}) {
    return ['groups', {
        currentPage: params.currentPage,
        pageSize: params.pageSize,
        keyword: params.keyword,
    }] as const;
}
