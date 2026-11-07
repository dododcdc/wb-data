import { Archive, ArchiveRestore, Braces, Eye, Pencil } from 'lucide-react';
import type { ParameterGroupSummary } from '../../api/parameterGroups';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';

interface ParameterGroupTableProps {
    data: ParameterGroupSummary[];
    canWrite: boolean;
    isLoading: boolean;
    isRefreshing: boolean;
    errorMessage: string;
    hasActiveFilter: boolean;
    hasFooter: boolean;
    onPreview: (record: ParameterGroupSummary) => void;
    onEdit: (record: ParameterGroupSummary) => void;
    onAction: (record: ParameterGroupSummary) => void;
    onCreate: () => void;
    onClearFilters: () => void;
    onRetry: () => void;
}

function formatUpdatedAt(value: string) {
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(value));
}

export function ParameterGroupTable(props: ParameterGroupTableProps) {
    const {
        data,
        canWrite,
        isLoading,
        isRefreshing,
        errorMessage,
        hasActiveFilter,
        hasFooter,
        onPreview,
        onEdit,
        onAction,
        onCreate,
        onClearFilters,
        onRetry,
    } = props;

    const getActions = (record: ParameterGroupSummary): RowActionItem[] => {
        const actions: RowActionItem[] = [
            {
                key: 'preview',
                label: `预览${record.name}`,
                icon: Eye,
                onClick: () => onPreview(record),
            },
        ];
        if (canWrite && record.status === 'ACTIVE') {
            actions.push(
                {
                    key: 'edit',
                    label: `编辑${record.name}`,
                    icon: Pencil,
                    onClick: () => onEdit(record),
                },
                {
                    key: 'archive',
                    label: `归档${record.name}`,
                    icon: Archive,
                    onClick: () => onAction(record),
                },
            );
        } else if (canWrite) {
            actions.push({
                key: 'restore',
                label: `恢复${record.name}`,
                icon: ArchiveRestore,
                onClick: () => onAction(record),
            });
        }
        return actions;
    };

    const columns: DataListColumn<ParameterGroupSummary>[] = [
        {
            key: 'identity',
            header: '参数组',
            primary: true,
            width: '36%',
            cell: (record) => (
                <div className="wb-list-cell-stack">
                    <span title={record.name}>{record.name}</span>
                    {record.description ? (
                        <span className="wb-list-secondary wb-list-secondary-text" title={record.description}>
                            {record.description}
                        </span>
                    ) : null}
                </div>
            ),
        },
        {
            key: 'parameterCount',
            header: '参数',
            mono: true,
            width: 120,
            cell: (record) => `${record.parameterCount} 个参数`,
        },
        {
            key: 'version',
            header: '版本',
            mono: true,
            width: 90,
            cell: (record) => `v${record.version}`,
        },
        {
            key: 'status',
            header: '状态',
            width: 110,
            cell: (record) => (
                <StatusPill tone={record.status === 'ACTIVE' ? 'success' : 'warning'}>
                    {record.status === 'ACTIVE' ? '使用中' : '已归档'}
                </StatusPill>
            ),
        },
        {
            key: 'updatedAt',
            header: '最近更新',
            mono: true,
            width: 160,
            cell: (record) => formatUpdatedAt(record.updatedAt),
        },
        {
            key: 'actions',
            header: '操作',
            align: 'right',
            width: 120,
            cell: (record) => (
                <RowActions
                    items={getActions(record)}
                    maxVisible={canWrite && record.status === 'ACTIVE' ? 2 : 1}
                    menuLabel={`${record.name}的更多操作`}
                />
            ),
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
            rowKey={(record) => record.id}
            ariaLabel="参数组列表"
            minWidth="860px"
            state={state}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            hasFooter={hasFooter}
            emptyIcon={<Braces size={32} />}
            emptyTitle="还没有参数组"
            emptyDescription="创建一组可复用的参数，在多个任务中保持一致。"
            emptyAction={canWrite ? <Button type="button" size="sm" onClick={onCreate}>新建参数组</Button> : undefined}
            filteredEmptyTitle="没有匹配的参数组"
            filteredEmptyDescription="当前搜索或状态筛选没有结果，清空后查看全部参数组。"
            filteredEmptyAction={<Button type="button" size="sm" variant="outline" onClick={onClearFilters}>清空筛选</Button>}
            errorAction={<Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>}
        />
    );
}
