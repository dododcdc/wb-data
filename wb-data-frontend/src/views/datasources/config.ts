export const STATUS_FILTER_OPTIONS = [
    { label: '全部状态', value: '' },
    { label: '已启用', value: 'ENABLED' },
    { label: '已停用', value: 'DISABLED' },
];

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];
export const DEFAULT_PAGE_SIZE = 7;

export function buildDataSourcePageQueryKey(params: {
    currentPage: number;
    pageSize: number;
    keyword: string;
}) {
    return ['dataSources', {
        currentPage: params.currentPage,
        pageSize: params.pageSize,
        keyword: params.keyword,
    }] as const;
}

export function parsePageParam(value: string | null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parsePageSizeParam(value: string | null) {
    const parsed = Number(value);
    return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

export function parseTypeParam(value: string | null) {
    return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

export function parseStatusParam(value: string | null) {
    if (value === 'ENABLED' || value === 'DISABLED') return value;
    return '';
}

export function formatTimestamp(value?: string) {
    if (!value) return '--';

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return value;

    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(parsedDate);
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
