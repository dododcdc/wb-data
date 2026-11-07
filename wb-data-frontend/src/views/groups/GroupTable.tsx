import { FolderKanban, Pencil, Ban, CheckCircle } from 'lucide-react';
import { GroupDetail } from '../../api/group';
import { formatTimestamp } from './config';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';

interface GroupTableProps {
    data: GroupDetail[];
    isLoading: boolean;
    isRefreshing: boolean;
    errorMessage: string;
    hasActiveFilter: boolean;
    hasFooter: boolean;
    onEdit: (group: GroupDetail) => void;
    onDisable: (group: GroupDetail) => void;
    onEnable: (group: GroupDetail) => void;
    onCreate: () => void;
    onClearFilters: () => void;
    onRetry: () => void;
    pendingId: number | null;
}

export function GroupTable(props: GroupTableProps) {
    const {
        data,
        isLoading,
        isRefreshing,
        errorMessage,
        hasActiveFilter,
        hasFooter,
        onEdit,
        onDisable,
        onEnable,
        onCreate,
        onClearFilters,
        onRetry,
        pendingId,
    } = props;

    const getActions = (item: GroupDetail): RowActionItem[] => [
        {
            key: 'edit',
            label: '编辑项目组',
            icon: Pencil,
            onClick: () => onEdit(item),
        },
        item.status === 'active'
            ? {
                key: 'disable',
                label: '禁用项目组',
                icon: Ban,
                tone: 'danger',
                pending: pendingId === item.id,
                onClick: () => onDisable(item),
            }
            : {
                key: 'enable',
                label: '启用项目组',
                icon: CheckCircle,
                pending: pendingId === item.id,
                onClick: () => onEnable(item),
            },
    ];

    const columns: DataListColumn<GroupDetail>[] = [
        {
            key: 'identity',
            header: '项目组',
            primary: true,
            width: '40%',
            cell: (item) => (
                <div className="wb-list-cell-stack">
                    <span title={item.name}>{item.name}</span>
                    <span className="wb-list-secondary wb-list-secondary-text" title={item.description || undefined}>
                        {item.description || '--'}
                    </span>
                </div>
            ),
        },
        {
            key: 'status',
            header: '状态',
            width: 110,
            cell: (item) => (
                <StatusPill tone={item.status === 'active' ? 'success' : 'neutral'}>
                    {item.status === 'active' ? '正常' : '已禁用'}
                </StatusPill>
            ),
        },
        {
            key: 'memberCount',
            header: '成员数',
            align: 'right',
            mono: true,
            width: 100,
            cell: (item) => item.memberCount,
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
            cell: (item) => <RowActions items={getActions(item)} maxVisible={1} menuLabel={`${item.name}的更多操作`} />,
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
            ariaLabel="项目组列表"
            minWidth="860px"
            state={state}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            hasFooter={hasFooter}
            emptyIcon={<FolderKanban size={32} />}
            emptyTitle="还没有项目组"
            emptyDescription="新建一个项目组，开始管理成员和数据研发资源。"
            emptyAction={<Button type="button" size="sm" onClick={onCreate}>新建项目组</Button>}
            filteredEmptyTitle="没有匹配的项目组"
            filteredEmptyDescription="当前搜索条件没有结果，清空后查看全部项目组。"
            filteredEmptyAction={<Button type="button" size="sm" variant="outline" onClick={onClearFilters}>清空筛选</Button>}
            errorAction={<Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>}
        />
    );
}
