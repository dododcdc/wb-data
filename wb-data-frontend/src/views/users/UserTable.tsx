import { Edit3, KeyRound, Power, Users } from 'lucide-react';
import { UserRecord } from '../../api/user';
import { formatTimestamp, getStatusLabel, getSystemRoleLabel } from './config';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';

interface UserTableProps {
    data: UserRecord[];
    isLoading: boolean;
    isRefreshing: boolean;
    errorMessage: string;
    hasActiveFilter: boolean;
    hasFooter: boolean;
    onEdit: (user: UserRecord) => void;
    onToggleStatus: (user: UserRecord) => void;
    onResetPassword: (user: UserRecord) => void;
    onCreate: () => void;
    onClearFilters: () => void;
    onRetry: () => void;
    statusPendingId: number | null;
}

export function UserTable(props: UserTableProps) {
    const {
        data,
        isLoading,
        isRefreshing,
        errorMessage,
        hasActiveFilter,
        hasFooter,
        onEdit,
        onToggleStatus,
        onResetPassword,
        onCreate,
        onClearFilters,
        onRetry,
        statusPendingId,
    } = props;

    const getActions = (item: UserRecord): RowActionItem[] => [
        {
            key: 'edit',
            label: '编辑用户',
            icon: Edit3,
            onClick: () => onEdit(item),
        },
        {
            key: 'reset-password',
            label: '重置密码',
            icon: KeyRound,
            onClick: () => onResetPassword(item),
        },
        {
            key: 'status',
            label: item.status === 'ACTIVE' ? '禁用用户' : '启用用户',
            icon: Power,
            tone: item.status === 'ACTIVE' ? 'danger' : 'default',
            pending: statusPendingId === item.id,
            onClick: () => onToggleStatus(item),
        },
    ];

    const columns: DataListColumn<UserRecord>[] = [
        {
            key: 'identity',
            header: '用户',
            primary: true,
            width: '30%',
            cell: (item) => (
                <div className="wb-list-cell-stack">
                    <span title={item.username}>{item.username}</span>
                    <span className="wb-list-secondary wb-list-secondary-text" title={item.displayName || undefined}>
                        {item.displayName || '--'}
                    </span>
                </div>
            ),
        },
        {
            key: 'role',
            header: '系统角色',
            width: 140,
            cell: (item) => <StatusPill tone="neutral" dot={false}>{getSystemRoleLabel(item.systemRole)}</StatusPill>,
        },
        {
            key: 'status',
            header: '状态',
            width: 110,
            cell: (item) => (
                <StatusPill tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {getStatusLabel(item.status)}
                </StatusPill>
            ),
        },
        {
            key: 'lastLoginAt',
            header: '最近登录',
            mono: true,
            width: 190,
            cell: (item) => formatTimestamp(item.lastLoginAt),
        },
        {
            key: 'createdAt',
            header: '创建时间',
            mono: true,
            width: 190,
            cell: (item) => formatTimestamp(item.createdAt),
        },
        {
            key: 'actions',
            header: '操作',
            align: 'right',
            width: 80,
            cell: (item) => <RowActions items={getActions(item)} maxVisible={1} menuLabel={`${item.username}的更多操作`} />,
        },
    ];

    const state = isLoading && data.length === 0
        ? 'loading'
        : errorMessage && data.length === 0
            ? 'error'
            : data.length === 0
                ? hasActiveFilter ? 'filtered-empty' : 'empty'
                : 'ready';

    return (
        <DataList
            rows={data}
            columns={columns}
            rowKey={(item) => item.id}
            ariaLabel="用户列表"
            minWidth="960px"
            state={state}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            hasFooter={hasFooter}
            emptyIcon={<Users size={32} />}
            emptyTitle="还没有用户"
            emptyDescription="新建一个用户，并为其分配系统角色和项目组。"
            emptyAction={<Button type="button" size="sm" onClick={onCreate}>新建用户</Button>}
            filteredEmptyTitle="没有匹配的用户"
            filteredEmptyDescription="当前搜索条件没有结果，清空后查看全部用户。"
            filteredEmptyAction={<Button type="button" size="sm" variant="outline" onClick={onClearFilters}>清空筛选</Button>}
            errorAction={<Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>}
        />
    );
}
