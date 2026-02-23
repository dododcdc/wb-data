import { useEffect, useState, useRef } from 'react';
import { getDataSourcePage, DataSource, deleteDataSource, updateDataSourceStatus } from '../api/datasource';
import { Plus, Edit, Trash2, Power } from 'lucide-react';
import { DataSourceSelect } from '../components/DataSourceSelect';
import DataSourceForm from './DataSourceForm';
import './DataSourceList.css';

export default function DataSourceList() {
    const [data, setData] = useState<DataSource[]>([]);
    const [loading, setLoading] = useState(false);
    const [filterName, setFilterName] = useState('');
    const [filterType, setFilterType] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(7);
    const [total, setTotal] = useState(0);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const isComposing = useRef(false);

    const fetchList = async () => {
        setLoading(true);
        try {
            const res = await getDataSourcePage({
                page: currentPage,
                size: pageSize,
                keyword: filterName || undefined,
                typeList: filterType.length > 0 ? filterType : undefined
            });
            setData(res.records || []);
            setTotal(res.total || 0);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isComposing.current) return;
        const timer = setTimeout(() => {
            fetchList();
        }, 500);
        return () => clearTimeout(timer);
    }, [filterName, filterType, currentPage, pageSize]);

    const handleCompositionStart = () => {
        isComposing.current = true;
    };

    const handleCompositionEnd = (e: any) => {
        isComposing.current = false;
        setFilterName(e.target.value);
        setCurrentPage(1); // Reset to page 1 on search
        fetchList();
    };

    const handleDelete = async (id: number) => {
        if (window.confirm('Are you sure to delete this data source?')) {
            await deleteDataSource(id);
            fetchList();
        }
    };

    const handleToggleStatus = async (id: number, currentStatus: string) => {
        const newStatus = currentStatus === 'ENABLED' ? 'DISABLED' : 'ENABLED';
        await updateDataSourceStatus(id, newStatus);
        fetchList();
    };

    const handleReset = () => {
        setFilterName('');
        setFilterType([]);
        setCurrentPage(1);
        setTimeout(fetchList, 0);
    };

    const totalPages = Math.ceil(total / pageSize);

    return (
        <div className="page-container">
            <div className="filter-section">
                <div className="filter-controls">
                    <input
                        type="text"
                        placeholder="输入主机名或描述搜索..."
                        value={filterName}
                        onChange={(e) => {
                            setFilterName(e.target.value);
                            setCurrentPage(1);
                        }}
                        onCompositionStart={handleCompositionStart}
                        onCompositionEnd={handleCompositionEnd}
                        className="filter-input"
                    />
                    <div style={{ width: '260px' }}>
                        <DataSourceSelect
                            multiple={true}
                            value={filterType}
                            onChange={(val) => {
                                setFilterType(val);
                                setCurrentPage(1);
                            }}
                            placeholder="选择类型（可多选）"
                            options={[
                                { label: 'MySQL', value: 'MYSQL' },
                                { label: 'Hive', value: 'HIVE' },
                                { label: 'PostgreSQL', value: 'POSTGRESQL' },
                                { label: 'StarRocks', value: 'STARROCKS' }
                            ]}
                        />
                    </div>
                    <button className="secondary-btn" onClick={handleReset}>重置</button>
                </div>
                <button className="primary-btn" onClick={() => { setEditingId(null); setIsFormOpen(true); }}>
                    <Plus size={16} /> 新建数据源
                </button>
            </div>

            <div className="table-container">
                {loading ? (
                    <div className="loading">加载中...</div>
                ) : (
                    <>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>名称</th>
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
                                        <td>{item.id}</td>
                                        <td>{item.name}</td>
                                        <td><span className={`type-badge ${item.type.toLowerCase()}`}>{item.type}</span></td>
                                        <td className="connection-info">{item.host}:{item.port}</td>
                                        <td>
                                            <span className={`status-dot ${item.status === 'ENABLED' ? 'active' : 'inactive'}`}></span>
                                            {item.status}
                                        </td>
                                        <td>{item.owner}</td>
                                        <td>{item.updatedAt}</td>
                                        <td>
                                            <div className="actions">
                                                <button className="icon-btn edit" onClick={() => { setEditingId(item.id); setIsFormOpen(true); }} title="编辑">
                                                    <Edit size={16} />
                                                </button>
                                                <button className="icon-btn toggle" onClick={() => handleToggleStatus(item.id, item.status)} title="切换状态">
                                                    <Power size={16} />
                                                </button>
                                                <button className="icon-btn delete" onClick={() => handleDelete(item.id)} title="删除">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {data.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="empty-state">未找到任何数据源。</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        {total > 0 && (
                            <div className="pagination-footer">
                                <div className="page-info">
                                    共 <span>{total}</span> 条数据，
                                    每页展示
                                    <select value={pageSize} onChange={e => {
                                        setPageSize(Number(e.target.value));
                                        setCurrentPage(1);
                                    }}>
                                        <option value={7}>7</option>
                                        <option value={10}>10</option>
                                        <option value={20}>20</option>
                                        <option value={50}>50</option>
                                    </select>
                                    条
                                </div>
                                <div className="page-nav">
                                    <button
                                        disabled={currentPage === 1}
                                        onClick={() => setCurrentPage(p => p - 1)}
                                        className="nav-btn"
                                    >
                                        上一页
                                    </button>
                                    <div className="page-numbers">
                                        {[...Array(totalPages)].map((_, i) => {
                                            const p = i + 1;
                                            // Show first, last, and window around current
                                            if (totalPages > 7) {
                                                if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                                                    return (
                                                        <button
                                                            key={p}
                                                            className={`page-num ${currentPage === p ? 'active' : ''}`}
                                                            onClick={() => setCurrentPage(p)}
                                                        >
                                                            {p}
                                                        </button>
                                                    );
                                                }
                                                // Show ellipsis if there's a gap
                                                if (p === currentPage - 2 || p === currentPage + 2) {
                                                    return <span key={p} className="pagination-ellipsis">...</span>;
                                                }
                                                return null;
                                            }
                                            return (
                                                <button
                                                    key={p}
                                                    className={`page-num ${currentPage === p ? 'active' : ''}`}
                                                    onClick={() => setCurrentPage(p)}
                                                >
                                                    {p}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button
                                        disabled={currentPage === totalPages}
                                        onClick={() => setCurrentPage(p => p + 1)}
                                        className="nav-btn"
                                    >
                                        下一页
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <DataSourceForm
                open={isFormOpen}
                onOpenChange={(details) => setIsFormOpen(details.open)}
                dataSourceId={editingId}
                onSuccess={(action) => {
                    setIsFormOpen(false);
                    if (action === 'create') {
                        setFilterName('');
                        setFilterType([]);
                        if (currentPage === 1) {
                            fetchList();
                        } else {
                            setCurrentPage(1);
                        }
                    } else {
                        fetchList();
                    }
                }}
            />
        </div >
    );
}
