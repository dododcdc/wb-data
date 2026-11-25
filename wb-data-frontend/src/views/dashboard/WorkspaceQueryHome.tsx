import { useMemo, useState } from 'react';
import { ArrowRight, Database, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { WorkspaceDataSourceBrief, WorkspaceSummaryResponse } from '../../api/workspace';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { StatusPill } from '../../components/ui/list/StatusPill';
import {
    dataSourceTypeBadgeClass,
    dataSourceTypeLabel,
    formatCount,
    formatDataSourceBreakdown,
    rememberSelectedQueryDataSource,
    resolveLastQueryContext,
    resolveRoleLabel,
} from './dashboardUtils';

interface WorkspaceQueryHomeProps {
    summary: WorkspaceSummaryResponse;
    canUseQuery: boolean;
    canExportQuery: boolean;
}

export function WorkspaceQueryHome({
    summary,
    canUseQuery,
    canExportQuery,
}: WorkspaceQueryHomeProps) {
    const navigate = useNavigate();
    const [selectedType, setSelectedType] = useState<string>('ALL');

    const datasources = summary.datasources;
    const allItems = useMemo(() => datasources?.items ?? [], [datasources?.items]);
    const availableTypes = useMemo(() => {
        const types = new Set<string>();
        for (const item of datasources?.byType ?? []) {
            types.add(item.type);
        }
        for (const item of allItems) {
            types.add(item.type);
        }
        return Array.from(types);
    }, [allItems, datasources?.byType]);

    const visibleItems = useMemo(() => {
        if (selectedType === 'ALL') return allItems;
        return allItems.filter((item) => item.type === selectedType);
    }, [allItems, selectedType]);

    const lastQueryContext = useMemo(
        () => resolveLastQueryContext(allItems),
        [allItems],
    );

    const openQueryWithDataSource = (dataSourceId?: number) => {
        if (dataSourceId != null) {
            rememberSelectedQueryDataSource(dataSourceId);
        }
        navigate('/query');
    };

    const columns: DataListColumn<WorkspaceDataSourceBrief>[] = [
        {
            key: 'name',
            header: '数据源名称',
            primary: true,
            mono: true,
            truncate: true,
            cell: (row) => (
                <div className="wb-list-cell-stack">
                    <span>{row.name}</span>
                    {row.description ? (
                        <span className="wb-list-secondary wb-list-secondary-text">{row.description}</span>
                    ) : null}
                </div>
            ),
        },
        {
            key: 'type',
            header: '类型',
            cell: (row) => (
                <span className={dataSourceTypeBadgeClass(row.type)}>
                    {dataSourceTypeLabel(row.type)}
                </span>
            ),
        },
        {
            key: 'databaseName',
            header: '默认库 / Schema',
            mono: true,
            cell: (row) => row.databaseName || '—',
        },
        {
            key: 'status',
            header: '状态',
            cell: (row) => {
                const enabled = row.status?.toUpperCase() === 'ENABLED';
                return (
                    <StatusPill tone={enabled ? 'success' : 'neutral'}>
                        {enabled ? '已启用' : '已禁用'}
                    </StatusPill>
                );
            },
        },
        {
            key: 'actions',
            header: '操作',
            align: 'right',
            cell: (row) => (
                canUseQuery ? (
                    <button
                        type="button"
                        className="wb-inline-link-btn"
                        onClick={(event) => {
                            event.stopPropagation();
                            openQueryWithDataSource(row.id);
                        }}
                    >
                        <span>进入查询</span>
                        <ArrowRight size={13} aria-hidden="true" />
                    </button>
                ) : (
                    <Link className="wb-inline-link-btn" to="/datasources">
                        <span>查看</span>
                    </Link>
                )
            ),
        },
    ];

    return (
        <div className="wb-home-page animate-enter">
            {/* 1. PageHeader */}
            <header className="wb-page-header">
                <div className="wb-page-header-copy">
                    <h1 className="wb-page-title">{summary.groupName}</h1>
                    <div className="wb-page-meta">
                        <StatusPill tone="neutral" dot={false}>
                            {resolveRoleLabel(summary.role)}
                        </StatusPill>
                        {datasources ? (
                            <span className="wb-commit-summary">
                                已授权 <span className="wb-mono-num">{formatCount(datasources.enabledCount)}</span> 个可用数据源
                                {canUseQuery ? ' · 支持 SQL 探索与查询' : ' · 数据源只读查看'}
                            </span>
                        ) : null}
                    </div>
                </div>

                {canUseQuery ? (
                    <div className="wb-page-actions">
                        <Button className="wb-btn-brand" onClick={() => navigate('/query')}>
                            <Search size={15} />
                            <span>打开自助查询</span>
                        </Button>
                    </div>
                ) : null}
            </header>

            {/* 2. MetricStrip (3 格) */}
            <section className="wb-metric-strip cols-3" aria-label="查询工作区摘要">
                <div className="wb-metric-cell is-static">
                    <div className="wb-metric-head">
                        <span className="wb-metric-label">可用数据源</span>
                    </div>
                    <div className="wb-metric-value">{formatCount(datasources?.enabledCount ?? 0)}</div>
                    <div className="wb-metric-sub">{formatDataSourceBreakdown(datasources?.byType)}</div>
                </div>

                <div className="wb-metric-cell is-static">
                    <div className="wb-metric-head">
                        <span className="wb-metric-label">
                            {lastQueryContext?.fromHistory ? '上次查询数据源' : '推荐数据源'}
                        </span>
                    </div>
                    <div className="wb-metric-value is-text">
                        {lastQueryContext?.dataSource.name ?? '暂无可用连接'}
                    </div>
                    <div className="wb-metric-sub">
                        {lastQueryContext?.databaseName
                            ? `默认库：${lastQueryContext.databaseName}`
                            : '进入查询后可切换目标库'}
                    </div>
                </div>

                <div className="wb-metric-cell is-static">
                    <div className="wb-metric-head">
                        <span className="wb-metric-label">结果导出能力</span>
                    </div>
                    <div className="wb-metric-value is-text">
                        {canExportQuery ? 'CSV / JSON' : '在线结果预览'}
                    </div>
                    <div className="wb-metric-sub">支持 SQL 格式化与库表字段补全</div>
                </div>
            </section>

            {/* 3. 主体双栏 */}
            <div className="wb-home-grid">
                <section className="wb-section-panel" aria-label="可查数据源列表">
                    <div className="wb-section-header">
                        <div className="wb-section-title-group">
                            <h2 className="wb-section-title">可查数据源</h2>
                            {availableTypes.length > 1 ? (
                                <div className="wb-chip-group" role="group" aria-label="按数据库类型筛选">
                                    <button
                                        type="button"
                                        className={`wb-chip-btn${selectedType === 'ALL' ? ' is-active' : ''}`}
                                        aria-pressed={selectedType === 'ALL'}
                                        onClick={() => setSelectedType('ALL')}
                                    >
                                        全部
                                    </button>
                                    {availableTypes.map((type) => (
                                        <button
                                            key={type}
                                            type="button"
                                            className={`wb-chip-btn${selectedType === type ? ' is-active' : ''}`}
                                            aria-pressed={selectedType === type}
                                            onClick={() => setSelectedType(type)}
                                        >
                                            {dataSourceTypeLabel(type)}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>

                        {datasources ? (
                            <Link className="wb-section-more-link" to="/datasources">
                                数据源管理
                            </Link>
                        ) : null}
                    </div>

                    <DataList
                        className="wb-home-embedded-list"
                        rows={visibleItems}
                        columns={columns}
                        rowKey={(row) => row.id}
                        ariaLabel="项目组可查数据源列表"
                        minWidth="560px"
                        state={visibleItems.length === 0 ? (selectedType !== 'ALL' ? 'filtered-empty' : 'empty') : 'ready'}
                        emptyIcon={<Database size={24} />}
                        emptyTitle="当前项目组暂无可用数据源"
                        emptyDescription="联系项目组管理员登记数据源后即可在此发起查询。"
                        filteredEmptyTitle="该类型下暂无数据源"
                        filteredEmptyDescription="试着清空类型筛选后重新查看。"
                        filteredEmptyAction={(
                            <Button variant="outline" size="sm" onClick={() => setSelectedType('ALL')}>
                                清空筛选
                            </Button>
                        )}
                        onRowClick={canUseQuery ? (row) => openQueryWithDataSource(row.id) : undefined}
                        rowAriaLabel={(row) => `使用 ${row.name} 进入自助查询`}
                    />
                </section>

                <aside className="wb-home-side">
                    {canUseQuery ? (
                        <section className="wb-section-panel wb-side-card" aria-label="继续上次查询会话">
                            <div>
                                <div className="wb-metric-label">
                                    {lastQueryContext?.fromHistory ? '继续上次会话' : '快速开始查询'}
                                </div>
                                <h2 className="wb-side-card-title">
                                    {lastQueryContext?.dataSource.name ?? '选择数据源开始编写 SQL'}
                                </h2>
                                <p className="wb-side-card-desc">
                                    {lastQueryContext?.databaseName
                                        ? `默认库 ${lastQueryContext.databaseName} · 保留最近切换的库表上下文`
                                        : '进入自助查询工作台选择数据源与库表结构'}
                                </p>
                            </div>
                            <Button
                                className="wb-btn-brand wb-btn-block"
                                onClick={() => openQueryWithDataSource(lastQueryContext?.dataSource.id)}
                            >
                                <span>{lastQueryContext ? '继续编写 SQL' : '打开自助查询'}</span>
                            </Button>
                        </section>
                    ) : null}

                    <section className="wb-section-panel" aria-label="自助查询能力说明">
                        <div className="wb-section-header">
                            <h2 className="wb-section-title">查询能力说明</h2>
                        </div>
                        <div className="wb-side-notes">
                            <p>· 支持按当前数据源方言进行 SQL 格式化与库表字段自动补全</p>
                            <p>
                                · 查询结果支持列宽调整、单元格预览
                                {canExportQuery ? '与 CSV / JSON 本地导出' : ''}
                            </p>
                            <p>· 如需配置离线调度或查看任务依赖，请联系组管理员开通离线开发权限</p>
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    );
}
