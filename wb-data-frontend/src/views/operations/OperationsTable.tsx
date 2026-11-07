import { Activity, ExternalLink, RotateCcw } from 'lucide-react';
import type { OperationsExecutionListItem } from '../../api/operations';
import { getExecutionPresentation, getExecutionStatusLabel } from '../../components/execution/executionPresentation';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';
import { formatBrowserDateTime } from '../../lib/dateTime';

interface OperationsTableProps {
    rows: OperationsExecutionListItem[];
    canRerun: boolean;
    isLoading: boolean;
    isRefreshing: boolean;
    errorMessage: string;
    hasFooter: boolean;
    pendingRerunId: string | null;
    onOpenDetail: (executionId: string) => void;
    onRerun: (row: OperationsExecutionListItem) => void;
    onResetFilters: () => void;
    onRetry: () => void;
}

function formatDuration(durationMs: number | null) {
    if (durationMs == null) return '—';
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${rest}s`;
}

function statusTone(status: string): 'success' | 'danger' | 'info' | 'neutral' {
    const tone = getExecutionPresentation(status).dotTone;
    if (tone === 'success') return 'success';
    if (tone === 'failed') return 'danger';
    if (tone === 'running') return 'info';
    return 'neutral';
}

export function OperationsTable(props: OperationsTableProps) {
    const {
        rows,
        canRerun,
        isLoading,
        isRefreshing,
        errorMessage,
        hasFooter,
        pendingRerunId,
        onOpenDetail,
        onRerun,
        onResetFilters,
        onRetry,
    } = props;

    const getActions = (row: OperationsExecutionListItem): RowActionItem[] => {
        const actions: RowActionItem[] = [
            {
                key: 'detail',
                label: `查看 ${row.flowId} 详情`,
                icon: ExternalLink,
                onClick: () => onOpenDetail(row.id),
            },
        ];
        if (row.rerunnable && canRerun) {
            actions.push({
                key: 'rerun',
                label: `重跑 ${row.flowId}`,
                icon: RotateCcw,
                pending: pendingRerunId === row.id,
                onClick: () => onRerun(row),
            });
        }
        return actions;
    };

    const columns: DataListColumn<OperationsExecutionListItem>[] = [
        {
            key: 'task',
            header: '任务',
            primary: true,
            width: '24%',
            cell: (row) => (
                <span className="operations-flow-cell">
                    <span className="operations-flow" title={row.flowId}>{row.flowId}</span>
                    {row.rerun ? <span className="operations-rerun-badge">重跑</span> : null}
                </span>
            ),
        },
        {
            key: 'branch',
            header: '分支',
            mono: true,
            width: '18%',
            cell: (row) => <span className="operations-branch" title={row.branch}>{row.branch}</span>,
        },
        {
            key: 'status',
            header: '状态',
            width: 110,
            cell: (row) => <StatusPill tone={statusTone(row.status)}>{getExecutionStatusLabel(row.status)}</StatusPill>,
        },
        {
            key: 'plannedAt',
            header: '计划执行时间',
            mono: true,
            width: 190,
            cell: (row) => formatBrowserDateTime(row.plannedAt),
        },
        {
            key: 'startDate',
            header: '开始时间',
            mono: true,
            width: 190,
            cell: (row) => formatBrowserDateTime(row.startDate),
        },
        {
            key: 'duration',
            header: '耗时',
            mono: true,
            align: 'right',
            width: 100,
            cell: (row) => formatDuration(row.durationMs),
        },
        {
            key: 'actions',
            header: '操作',
            align: 'right',
            width: 90,
            cell: (row) => <RowActions items={getActions(row)} />,
        },
    ];

    const state = isLoading && rows.length === 0
        ? 'loading'
        : errorMessage && rows.length === 0
            ? 'error'
            : rows.length === 0
                ? 'filtered-empty'
                : 'ready';

    return (
        <DataList
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            ariaLabel="运行记录"
            minWidth="1120px"
            className="wb-list-compact"
            onRowClick={(row) => onOpenDetail(row.id)}
            rowAriaLabel={(row) => `查看 ${row.flowId} 执行详情`}
            state={state}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            hasFooter={hasFooter}
            emptyIcon={<Activity size={32} />}
            filteredEmptyTitle="没有匹配的运行记录"
            filteredEmptyDescription="试着调整任务、分支、状态或时间范围。"
            filteredEmptyAction={<Button type="button" size="sm" variant="outline" onClick={onResetFilters}>重置筛选</Button>}
            errorAction={<Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>}
        />
    );
}
