import { parsePageParam as _parsePageParam, parsePageSizeParam as _parsePageSizeParam, formatTimestamp as _formatTimestamp } from '../../utils/pagination';

export const STATUS_FILTER_OPTIONS = [
    { label: '全部状态', value: '' },
    { label: '已启用', value: 'ENABLED' },
    { label: '已停用', value: 'DISABLED' },
];

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];
export const DEFAULT_PAGE_SIZE = 10;

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

export { _parsePageParam as parsePageParam };
export { _parsePageSizeParam as parsePageSizeParam };
export { _formatTimestamp as formatTimestamp };

export function parseTypeParam(value: string | null) {
    return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

export function parseStatusParam(value: string | null) {
    if (value === 'ENABLED' || value === 'DISABLED') return value;
    return '';
}

export function formatConnection(host?: string, port?: number, databaseName?: string) {
    const hostPart = host || '--';
    const portPart = port ? `:${port}` : '';
    const dbPart = databaseName ? ` / ${databaseName}` : '';
    return `${hostPart}${portPart}${dbPart}`;
}

export function getStatusLabel(status: string) {
    return status === 'ENABLED' ? '已启用' : '已停用';
}
