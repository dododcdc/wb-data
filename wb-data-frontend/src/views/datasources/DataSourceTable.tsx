import { Database, Edit3, Power, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { DataSource } from '../../api/datasource';
import { formatConnection, formatTimestamp, getStatusLabel } from './config';

interface DataSourceTableProps {
    data: DataSource[];
    canWrite: boolean;
    isRefreshing: boolean;
    errorMessage: string;
    onEdit: (id: number) => void;
    onDelete: (dataSource: DataSource) => void;
    onToggleStatus: (dataSource: DataSource) => void;
    deletePendingId: number | null;
    statusPendingId: number | null;
}

export function DataSourceTable(props: DataSourceTableProps) {
    const {
        data,
        canWrite,
        isRefreshing,
        errorMessage,
        onEdit,
        onDelete,
        onToggleStatus,
        deletePendingId,
        statusPendingId,
    } = props;

    if (errorMessage && data.length === 0) {
        return (
            <div className="datasource-error">
                <strong>列表加载失败</strong>
                <p>{errorMessage}</p>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="datasource-empty">
                <Database size={36} />
                <h3>还没有匹配的数据源</h3>
                <p>试着清空筛选条件，或者新建一个数据源作为第一条目录记录。</p>
            </div>
        );
    }

    return (
        <div className={`datasource-table-shell ${isRefreshing ? 'is-refreshing' : ''}`}>
            {errorMessage ? (
                <div className="datasource-inline-error" role="alert">
                    <strong>最新一次刷新失败</strong>
                    <p>{errorMessage}</p>
                </div>
            ) : null}
            <div className="datasource-table-progress" aria-hidden="true" />
            <div className="datasource-table-scroll">
                <table className="datasource-table">
                    <thead>
                        <tr>
                            <th>数据源</th>
                            <th>类型</th>
                            <th>连接信息</th>
                            <th>状态</th>
                            <th className="datasource-owner-column">负责人</th>
                            <th className="datasource-updated-column">更新时间</th>
                            {canWrite && <th className="datasource-actions-column">操作</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((item) => (
                            <tr key={item.id}>
                                <td>
                                    <div className="datasource-name-cell">
                                        <strong className="datasource-name-main">{item.name}</strong>
                                        <span className="datasource-description">{item.description || '暂无描述'}</span>
                                    </div>
                                </td>
                                <td>
                                    <span className={`type-badge ${item.type.toLowerCase()}`}>{item.type}</span>
                                </td>
                                <td className="datasource-connection">{formatConnection(item.host, item.port, item.databaseName)}</td>
                                <td className="datasource-status-cell">
                                    <span className={`datasource-status-pill ${item.status === 'ENABLED' ? 'enabled' : 'disabled'}`}>
                                        <span className="datasource-status-dot" />
                                        {getStatusLabel(item.status)}
                                    </span>
                                </td>
                                <td className="datasource-owner datasource-owner-column">{item.owner || '--'}</td>
                                <td className="datasource-updated-at datasource-updated-column">{formatTimestamp(item.updatedAt)}</td>
                                {canWrite && (
                                    <td className="datasource-actions-column">
                                        <TooltipProvider delayDuration={400}>
                                        <div className="datasource-actions">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        className="datasource-icon-btn"
                                                        onClick={() => onEdit(item.id)}
                                                        aria-label="编辑数据源"
                                                        type="button"
                                                    >
                                                        <Edit3 size={16} />
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent className="tooltip-content" side="bottom">编辑数据源</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        className="datasource-icon-btn"
                                                        disabled={statusPendingId === item.id}
                                                        onClick={() => onToggleStatus(item)}
                                                        aria-label={item.status === 'ENABLED' ? '停用数据源' : '启用数据源'}
                                                        type="button"
                                                    >
                                                        <Power size={16} />
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent className="tooltip-content" side="bottom">
                                                    {item.status === 'ENABLED' ? '停用' : '启用'}
                                                </TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        className="datasource-icon-btn danger"
                                                        disabled={deletePendingId === item.id}
                                                        onClick={() => onDelete(item)}
                                                        aria-label="删除数据源"
                                                        type="button"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent className="tooltip-content" side="bottom">删除数据源</TooltipContent>
                                            </Tooltip>
                                        </div>
                                        </TooltipProvider>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="datasource-refresh-overlay" aria-hidden={!isRefreshing}>
                <div className="datasource-refresh-pill">
                    <span className="datasource-refresh-dot" />
                    正在更新列表
                </div>
            </div>
        </div>
    );
}
