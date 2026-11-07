import { Cable, Database, Edit3, Power, Trash2 } from 'lucide-react';
import { DataSource } from '../../api/datasource';
import { formatConnection, formatTimestamp, getStatusLabel } from './config';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';

interface DataSourceTableProps {
    data: DataSource[];
    canWrite: boolean;
    isRefreshing: boolean;
    errorMessage: string;
    hasActiveFilter: boolean;
    hasFooter: boolean;
    onView: (id: number) => void;
    onTest: (dataSource: DataSource) => void;
    onEdit: (id: number) => void;
    onDelete: (dataSource: DataSource) => void;
    onToggleStatus: (dataSource: DataSource) => void;
    onCreate: () => void;
    onClearFilters: () => void;
    onRetry: () => void;
    deletePendingId: number | null;
    statusPendingId: number | null;
    testPendingId: number | null;
}

export function DataSourceTable(props: DataSourceTableProps) {
    const {
        data,
        canWrite,
        isRefreshing,
        errorMessage,
        hasActiveFilter,
        hasFooter,
        onView,
        onTest,
        onEdit,
        onDelete,
        onToggleStatus,
        onCreate,
        onClearFilters,
        onRetry,
        deletePendingId,
        statusPendingId,
        testPendingId,
    } = props;

    const getActions = (item: DataSource): RowActionItem[] => {
        const actions: RowActionItem[] = [
            {
                key: 'test',
                label: '测试连接',
                icon: Cable,
                pending: testPendingId === item.id,
                onClick: () => onTest(item),
            },
        ];
        if (canWrite) {
            actions.push(
                {
                    key: 'edit',
                    label: '编辑数据源',
                    icon: Edit3,
                    onClick: () => onEdit(item.id),
                },
                {
                    key: 'status',
                    label: item.status === 'ENABLED' ? '停用数据源' : '启用数据源',
                    icon: Power,
                    pending: statusPendingId === item.id,
                    onClick: () => onToggleStatus(item),
                },
                {
                    key: 'delete',
                    label: '删除数据源',
                    icon: Trash2,
                    tone: 'danger',
                    pending: deletePendingId === item.id,
                    onClick: () => onDelete(item),
                },
            );
        }
        return actions;
    };

    const columns: DataListColumn<DataSource>[] = [
        {
            key: 'name',
            header: '数据源',
            primary: true,
            width: '34%',
            cell: (item) => {
                const connection = formatConnection(item.host, item.port, item.databaseName);
                return (
                    <div className="wb-list-cell-stack">
                        <button
                            type="button"
                            className="wb-list-primary-action"
                            title={item.name}
                            aria-label={`查看数据源 ${item.name}`}
                            onClick={() => onView(item.id)}
                        >
                            {item.name}
                        </button>
                        <span className="wb-list-secondary" title={connection}>{connection}</span>
                    </div>
                );
            },
        },
        {
            key: 'type',
            header: '类型',
            width: 100,
            cell: (item) => <span className={`type-badge ${item.type.toLowerCase()}`}>{item.type}</span>,
        },
        {
            key: 'status',
            header: '状态',
            width: 110,
            cell: (item) => (
                <StatusPill tone={item.status === 'ENABLED' ? 'success' : 'neutral'}>
                    {getStatusLabel(item.status)}
                </StatusPill>
            ),
        },
        {
            key: 'owner',
            header: '负责人',
            width: 120,
            cell: (item) => item.owner || '--',
        },
        {
            key: 'updatedAt',
            header: '更新时间',
            mono: true,
            width: 190,
            cell: (item) => formatTimestamp(item.updatedAt),
        },
        {
            key: 'actions',
            header: '操作',
            align: 'right',
            width: 120,
            cell: (item) => <RowActions items={getActions(item)} menuLabel={`${item.name}的更多操作`} />,
        },
    ];

    const state = errorMessage && data.length === 0
        ? 'error'
        : data.length === 0
            ? hasActiveFilter ? 'filtered-empty' : 'empty'
            : 'ready';

    return (
        <DataList
            rows={data}
            columns={columns}
            rowKey={(item) => item.id}
            ariaLabel="数据源列表"
            minWidth="960px"
            state={state}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            hasFooter={hasFooter}
            emptyIcon={<Database size={32} />}
            emptyTitle="还没有数据源"
            emptyDescription="新建一个数据源，作为第一条目录记录。"
            emptyAction={canWrite ? <Button type="button" size="sm" onClick={onCreate}>新建数据源</Button> : undefined}
            filteredEmptyTitle="没有匹配的数据源"
            filteredEmptyDescription="当前搜索条件没有结果，清空后查看全部数据源。"
            filteredEmptyAction={<Button type="button" size="sm" variant="outline" onClick={onClearFilters}>清空筛选</Button>}
            errorAction={<Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>}
        />
    );
}
