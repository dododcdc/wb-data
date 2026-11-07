import { Users, UserCog, Trash2 } from 'lucide-react';
import type { MemberRecord } from '../../api/groupSettings';
import { formatTimestamp, getRoleLabel } from './config';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';

interface MemberTableProps {
    data: MemberRecord[];
    isLoading: boolean;
    isRefreshing: boolean;
    errorMessage: string;
    hasActiveFilter: boolean;
    hasFooter: boolean;
    canManage: boolean;
    currentUserId: number | null;
    onChangeRole: (member: MemberRecord) => void;
    onRemove: (member: MemberRecord) => void;
    onAddMember: () => void;
    onClearFilters: () => void;
    onRetry: () => void;
}

export default function MemberTable(props: MemberTableProps) {
    const {
        data,
        isLoading,
        isRefreshing,
        errorMessage,
        hasActiveFilter,
        hasFooter,
        canManage,
        currentUserId,
        onChangeRole,
        onRemove,
        onAddMember,
        onClearFilters,
        onRetry,
    } = props;

    const getActions = (member: MemberRecord): RowActionItem[] => [
        {
            key: 'change-role',
            label: '修改角色',
            icon: UserCog,
            onClick: () => onChangeRole(member),
        },
        {
            key: 'remove',
            label: '移除成员',
            icon: Trash2,
            tone: 'danger',
            onClick: () => onRemove(member),
        },
    ];

    const columns: DataListColumn<MemberRecord>[] = [
        {
            key: 'identity',
            header: '成员',
            primary: true,
            width: '36%',
            cell: (member) => {
                const isSelf = currentUserId === member.userId;
                return (
                    <div className="wb-list-cell-stack">
                        <span title={member.username}>
                            {member.username}
                            {isSelf ? <span className="wb-list-self-marker">我</span> : null}
                        </span>
                        <span className="wb-list-secondary wb-list-secondary-text" title={member.displayName || undefined}>
                            {member.displayName || '--'}
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'role',
            header: '项目组角色',
            width: 140,
            cell: (member) => <StatusPill tone="neutral" dot={false}>{getRoleLabel(member.role)}</StatusPill>,
        },
        {
            key: 'createdAt',
            header: '加入时间',
            mono: true,
            width: 190,
            cell: (member) => formatTimestamp(member.createdAt),
        },
    ];

    if (canManage) {
        columns.push({
            key: 'actions',
            header: '操作',
            align: 'right',
            width: 120,
            cell: (member) => currentUserId === member.userId
                ? <span className="wb-list-action-note">当前账号</span>
                : <RowActions items={getActions(member)} maxVisible={1} menuLabel={`${member.username}的更多操作`} />,
        });
    }

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
            rowKey={(member) => member.id}
            ariaLabel="项目组成员列表"
            minWidth="760px"
            state={state}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            hasFooter={hasFooter}
            emptyIcon={<Users size={32} />}
            emptyTitle="暂无成员"
            emptyDescription={canManage ? '当前项目组还没有成员，请添加成员。' : '当前项目组还没有成员。'}
            emptyAction={canManage ? <Button type="button" size="sm" onClick={onAddMember}>添加成员</Button> : undefined}
            filteredEmptyTitle="没有匹配的成员"
            filteredEmptyDescription="当前搜索条件没有结果，清空后查看全部成员。"
            filteredEmptyAction={<Button type="button" size="sm" variant="outline" onClick={onClearFilters}>清空筛选</Button>}
            errorAction={<Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>}
        />
    );
}
