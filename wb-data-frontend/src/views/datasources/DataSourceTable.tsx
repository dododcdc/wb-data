import { Database, Edit3, Power, Trash2 } from 'lucide-react';
import { DataSource } from '../../api/datasource';
import { formatConnection, formatTimestamp, getStatusLabel } from './config';

interface DataSourceTableProps {
    data: DataSource[];
    isLoading: boolean;
    isFetching: boolean;
    errorMessage: string;
    onEdit: (id: number) => void;
    onDelete: (id: number) => void;
    onToggleStatus: (dataSource: DataSource) => void;
    deletePendingId: number | null;
    statusPendingId: number | null;
}

export function DataSourceTable(props: DataSourceTableProps) {
    const {
        data,
        isLoading,
        isFetching,
        errorMessage,
        onEdit,
        onDelete,
        onToggleStatus,
        deletePendingId,
        statusPendingId,
    } = props;

    if (errorMessage) {
        return (
            <div className="datasource-error">
                <strong>列表加载失败</strong>
                <p>{errorMessage}</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="datasource-loading">
                <div className="datasource-loading-bar" />
                <div className="datasource-loading-bar short" />
                <div className="datasource-loading-bar" />
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
        <div className={`datasource-table-shell ${isFetching ? 'is-fetching' : ''}`}>
            <div className="datasource-table-scroll">
                <table className="datasource-table">
                    <thead>
                        <tr>
                            <th>数据源</th>
                            <th>类型</th>
                            <th>连接信息</th>
                            <th>状态</th>
                            <th>负责人</th>
                            <th>更新时间</th>
                            <th>操作</th>
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
                                <td>
                                    <span className={`datasource-status-pill ${item.status === 'ENABLED' ? 'enabled' : 'disabled'}`}>
                                        <span className="datasource-status-dot" />
                                        {getStatusLabel(item.status)}
                                    </span>
                                </td>
                                <td className="datasource-owner">{item.owner || '--'}</td>
                                <td>{formatTimestamp(item.updatedAt)}</td>
                                <td>
                                    <div className="datasource-actions">
                                        <button
                                            className="datasource-icon-btn"
                                            onClick={() => onEdit(item.id)}
                                            title="编辑数据源"
                                            aria-label="编辑数据源"
                                            type="button"
                                        >
                                            <Edit3 size={16} />
                                        </button>
                                        <button
                                            className="datasource-icon-btn"
                                            disabled={statusPendingId === item.id}
                                            onClick={() => onToggleStatus(item)}
                                            title={item.status === 'ENABLED' ? '停用' : '启用'}
                                            aria-label={item.status === 'ENABLED' ? '停用数据源' : '启用数据源'}
                                            type="button"
                                        >
                                            <Power size={16} />
                                        </button>
                                        <button
                                            className="datasource-icon-btn danger"
                                            disabled={deletePendingId === item.id}
                                            onClick={() => onDelete(item.id)}
                                            title="删除数据源"
                                            aria-label="删除数据源"
                                            type="button"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
