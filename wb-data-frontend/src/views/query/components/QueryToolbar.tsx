
import { Play, Loader2, PanelLeftClose, PanelLeft, Star, Wand2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip';
import { DataSourceSelect, type DataSourceOption } from '../../../components/DataSourceSelect';
import type { DataSource } from '../../../api/datasource';

export interface QueryToolbarProps {
    // Toolbar - Sidebar toggle
    sidebarCollapsed: boolean;
    hasHiddenMetadataHint: boolean;
    toggleSidebar: () => void;
    isMac: boolean;

    // Toolbar - Data Source
    selectedDsId: string | null;
    defaultDsId: string | null;
    toggleDefaultDataSource: () => void;
    dataSourceOptions: DataSourceOption[];
    selectedDsOption: DataSourceOption | null;
    applySelectedDataSource: (val: string, ds: DataSource | null) => void;
    setDsKeyword: (val: string) => void;
    loadingDs: boolean;
    loadingDsMore: boolean;
    dsHasMore: boolean;
    loadMoreDataSources: () => void;
    dsKeyword: string;

    // Toolbar - Database
    databaseOptions: DataSourceOption[];
    selectedDb: string | null;
    selectedDbOption: DataSourceOption | null;
    setSelectedDb: (val: string) => void;
    setDbKeyword: (val: string) => void;
    loadingDatabases: boolean;
    dbKeyword: string;

    // Toolbar - Actions
    handleFormat: () => void;
    handleRunQuery: () => void;
    queryLoadingVisible: boolean;

}

export function QueryToolbar({
    sidebarCollapsed,
    hasHiddenMetadataHint,
    toggleSidebar,
    isMac,
    selectedDsId,
    defaultDsId,
    toggleDefaultDataSource,
    dataSourceOptions,
    selectedDsOption,
    applySelectedDataSource,
    setDsKeyword,
    loadingDs,
    loadingDsMore,
    dsHasMore,
    loadMoreDataSources,
    dsKeyword,
    databaseOptions,
    selectedDb,
    selectedDbOption,
    setSelectedDb,
    setDbKeyword,
    loadingDatabases,
    dbKeyword,
    handleFormat,
    handleRunQuery,
    queryLoadingVisible,
}: QueryToolbarProps) {
    return (
        <header className={`query-toolbar ${sidebarCollapsed ? '' : 'has-left-separator'}`.trim()}>
                <div className="toolbar-left">
                    <TooltipProvider delayDuration={400}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    className={`sidebar-toggle-button toolbar-sidebar-toggle ${hasHiddenMetadataHint ? 'has-notice' : ''}`}
                                    onClick={toggleSidebar}
                                    aria-label={sidebarCollapsed ? '展开表结构' : '收起表结构'}
                                >
                                    {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
                                    {hasHiddenMetadataHint ? <span className="sidebar-toggle-notice" aria-hidden="true" /> : null}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">
                                {sidebarCollapsed ? '展开表结构' : '收起表结构'} <kbd>{isMac ? '⌘' : 'Ctrl'}+B</kbd>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <span className="toolbar-divider" />
                    <div className="toolbar-ds-group">
                        {selectedDsId ? (
                            <TooltipProvider delayDuration={400}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className={`default-ds-button ${defaultDsId === selectedDsId ? 'is-active' : ''}`.trim()}
                                            onClick={toggleDefaultDataSource}
                                            aria-label={defaultDsId === selectedDsId ? '取消默认数据源' : '设为默认数据源'}
                                        >
                                            <Star size={15} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        {defaultDsId === selectedDsId ? '取消默认数据源' : '设为默认数据源'}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ) : null}
                        <DataSourceSelect
                            options={dataSourceOptions}
                            value={String(selectedDsId)}
                            selectedOption={selectedDsOption}
                            onChange={(val, option) => {
                                applySelectedDataSource(val, (option?.raw as DataSource | undefined) ?? null);
                            }}
                            onInputChange={(val) => setDsKeyword(val)}
                            loading={loadingDs}
                            loadingMore={loadingDsMore}
                            hasMore={dsHasMore}
                            onLoadMore={loadMoreDataSources}
                            placeholder="搜索并选择数据源..."
                            theme="light"
                            disableClientFilter
                            virtualize
                            virtualItemSize={32}
                            ariaLabel="数据源选择"
                            emptyText={dsKeyword ? '未找到匹配的数据源' : '暂无数据源'}
                        />
                    </div>
                    {selectedDsId && (
                        <>
                            <span className="breadcrumb-divider">/</span>
                            <DataSourceSelect
                                options={databaseOptions}
                                value={selectedDb ?? undefined}
                                selectedOption={selectedDbOption}
                                onChange={(val) => setSelectedDb(val)}
                                onInputChange={(val) => setDbKeyword(val)}
                                loading={loadingDatabases}
                                placeholder="选择数据库"
                                theme="light"
                                disableClientFilter
                                ariaLabel="数据库选择"
                                emptyText={dbKeyword ? '未找到匹配数据库' : '暂无数据库'}
                            />
                        </>
                    )}
                </div>
                <div className="toolbar-right">
                    <TooltipProvider delayDuration={400}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    className="format-button-inline"
                                    onClick={handleFormat}
                                    aria-label="格式化 SQL"
                                >
                                    <Wand2 size={16} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">
                                格式化 <kbd>{isMac ? '⌘' : 'Ctrl'}+⇧+F</kbd>
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    className="run-button"
                                    onClick={() => handleRunQuery()}
                                    aria-label="执行 SQL"
                                >
                                    {queryLoadingVisible ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="white" />}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">
                                执行 <kbd>{isMac ? '⌘' : 'Ctrl'}+↵</kbd>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </header>
    );
}
