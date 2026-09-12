export const PAGE_SIZE_OPTIONS = [10, 20, 50];
export const DEFAULT_PAGE_SIZE = 10;

export { formatTimestamp } from '../../utils/pagination';

export function buildMemberPageQueryKey(params: {
    groupId: number | undefined;
    currentPage: number;
    pageSize: number;
    keyword: string;
}) {
    return ['group-settings-members', {
        groupId: params.groupId,
        currentPage: params.currentPage,
        pageSize: params.pageSize,
        keyword: params.keyword,
    }] as const;
}

export function getRoleLabel(role: string) {
    return role === 'GROUP_ADMIN' ? '项目组管理员' : '开发者';
}
