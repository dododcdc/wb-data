export { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE, parsePageParam, parsePageSizeParam, formatTimestamp } from '../../utils/pagination';

export function buildUserPageQueryKey(params: {
    currentPage: number;
    pageSize: number;
    keyword: string;
}) {
    return ['users', {
        currentPage: params.currentPage,
        pageSize: params.pageSize,
        keyword: params.keyword,
    }] as const;
}

export function getSystemRoleLabel(role: string) {
    return role === 'SYSTEM_ADMIN' ? '系统管理员' : '普通用户';
}

export function getStatusLabel(status: string) {
    return status === 'ACTIVE' ? '正常' : '已禁用';
}
