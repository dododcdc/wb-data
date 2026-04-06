import { useMemo } from 'react';
import { Loader2, Code2, Download, FileText, Sheet, AlertTriangle, CheckCircle2, Clock3, Info, Pin, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip';
import {
    isMac,
    PINNED_RESULT_LIMIT,
    EXPORT_MAX_ROWS,
} from '../queryConstants';
import { formatResultTabLabel, formatTaskTimestamp, getExportTaskStatusMeta } from '../exportUtils';
import { buildQueryFeedback } from '../feedbackUtils';
import type { SavedQueryResult, ExportState } from '../types';
import type { QueryExportTask } from '../../../api/query';
import type { QueryResult } from '../../../api/query';
export interface QueryResultsPanelProps {
    resultCollapsed: boolean;
    toggleResultPanel: () => void;

    activeResultTab: 'current' | string;
    setActiveResultTab: (tabId: 'current' | string) => void;
    savedResults: SavedQueryResult[];
    currentResultTabNumber: number | null;
    activeSavedResult: SavedQueryResult | null;
    hasCurrentResultTab: boolean;

    displayedResult: QueryResult | null;
    displayedQueryError: string | null;
    currentResultCanPin: boolean;
    loadingQuery: boolean;
    queryResultLoadingVisible: boolean;

    canExport: boolean;
    exportState: ExportState;
    exportTasks: QueryExportTask[];
    loadingExportTasks: boolean;
    activeExportTaskCount: number;
    shouldShowExportTasksButton: boolean;

    showExportMenu: boolean;
    setShowExportMenu: React.Dispatch<React.SetStateAction<boolean>>;
    showExportTasksMenu: boolean;
    setShowExportTasksMenu: React.Dispatch<React.SetStateAction<boolean>>;
    exportMenuRef: React.RefObject<HTMLDivElement>;
    exportTasksMenuRef: React.RefObject<HTMLDivElement>;

    handlePinCurrentResult: () => void;
    handleCloseSavedResult: (id: string) => void;
    handleToggleSavedResultPin: (id: string) => void;
    handleFillSavedSql: () => void;
    createAsyncExportTask: (format: 'csv' | 'xlsx') => Promise<void>;
    downloadExportTask: (taskId: string) => void;
    loadExportTasks: () => Promise<void>;
}

export function QueryResultsPanel({
    resultCollapsed, toggleResultPanel,
    activeResultTab, setActiveResultTab, savedResults, currentResultTabNumber, activeSavedResult, hasCurrentResultTab,
    displayedResult, displayedQueryError, currentResultCanPin, loadingQuery, queryResultLoadingVisible,
    canExport, exportState, exportTasks, loadingExportTasks, activeExportTaskCount, shouldShowExportTasksButton,
    showExportMenu, setShowExportMenu, showExportTasksMenu, setShowExportTasksMenu, exportMenuRef, exportTasksMenuRef,
    handlePinCurrentResult, handleCloseSavedResult, handleToggleSavedResultPin, handleFillSavedSql,
    createAsyncExportTask, downloadExportTask, loadExportTasks,
}: QueryResultsPanelProps) {

    const hasHiddenResultHint =
        resultCollapsed &&
        (queryResultLoadingVisible || Boolean(displayedQueryError) || Boolean(displayedResult));

    const queryFeedback = useMemo(() => {
        return buildQueryFeedback({
            result: displayedResult,
            queryError: displayedQueryError,
            loadingQuery: activeResultTab === 'current' && hasCurrentResultTab ? loadingQuery : false,
            queryLoadingVisible: activeResultTab === 'current' && hasCurrentResultTab ? queryResultLoadingVisible : false,
        });
    }, [activeResultTab, displayedQueryError, displayedResult, hasCurrentResultTab, loadingQuery, queryResultLoadingVisible]);

    const displayedResultHasTable = Boolean(displayedResult && displayedResult.columns.length > 0);
    const displayedResultHasRows = Boolean(displayedResult && displayedResult.columns.length > 0 && displayedResult.rows.length > 0);

    return (
        <section className={`results-section ${resultCollapsed ? 'collapsed' : ''}`.trim()}>
            <div className="section-header">
                <div className="section-header-left">
                    {savedResults.length > 0 || hasCurrentResultTab ? (
                        <div className="result-tabs" role="tablist" aria-label="查询结果视图">
                            {savedResults.map((item) => (
                                <div
                                    key={item.id}
                                    role="tab"
                                    tabIndex={0}
                                    aria-selected={activeResultTab === item.id}
                                    className={`result-tab result-tab-pinned is-ready ${activeResultTab === item.id ? 'is-active' : ''}`.trim()}
                                    onClick={() => setActiveResultTab(item.id)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setActiveResultTab(item.id);
                                        }
                                    }}
                                >
                                    <span className="result-tab-dot" aria-hidden="true" />
                                    <span className="result-tab-label">{formatResultTabLabel(item.tabNumber)}</span>
                                    <TooltipProvider delayDuration={300}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    className={`result-tab-pin-button ${item.isPinned ? 'is-active' : ''}`.trim()}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleToggleSavedResultPin(item.id);
                                                    }}
                                                    aria-label={item.isPinned ? '取消钉住' : '钉住该结果'}
                                                >
                                                    <Pin size={12} className={`result-tab-pin ${item.isPinned ? 'is-active' : ''}`.trim()} />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent className="tooltip-content" side="top">
                                                {item.isPinned ? '取消钉住' : '钉住该结果'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                    <button
                                        type="button"
                                        className="result-tab-close"
                                        aria-label={`关闭 ${formatResultTabLabel(item.tabNumber)}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleCloseSavedResult(item.id);
                                        }}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                            {hasCurrentResultTab ? (
                                <div
                                    role="tab"
                                    tabIndex={0}
                                    aria-selected={activeResultTab === 'current'}
                                    className={`result-tab ${activeResultTab === 'current' ? 'is-active' : ''} ${queryFeedback.toneClass}`.trim()}
                                    onClick={() => setActiveResultTab('current')}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setActiveResultTab('current');
                                        }
                                    }}
                                >
                                    <span className="result-tab-dot" aria-hidden="true" />
                                    {activeResultTab === 'current' && queryFeedback.state === 'running'
                                        ? <Loader2 size={12} className="result-tab-spinner animate-spin" />
                                        : null}
                                    <span className="result-tab-label">{formatResultTabLabel(currentResultTabNumber!)}</span>
                                    <TooltipProvider delayDuration={300}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    className={`result-tab-pin-button ${currentResultCanPin ? '' : 'is-disabled'}`.trim()}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (!currentResultCanPin) {
                                                            return;
                                                        }
                                                        handlePinCurrentResult();
                                                    }}
                                                    aria-label={currentResultCanPin ? '钉住当前结果' : `最多保留 ${PINNED_RESULT_LIMIT} 个结果`}
                                                >
                                                    <Pin size={12} className="result-tab-pin" />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent className="tooltip-content" side="top">
                                                {currentResultCanPin ? '钉住当前结果' : `最多保留 ${PINNED_RESULT_LIMIT} 个结果`}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className={`result-status-chip ${queryFeedback.toneClass}`.trim()}>
                            <span className="result-tab-dot" aria-hidden="true" />
                            <span>{queryFeedback.label}</span>
                        </div>
                    )}
                    {queryFeedback.summary ? (
                        <div className={`result-summary ${queryFeedback.toneClass}`.trim()}>
                            {queryFeedback.state === 'running' ? <Loader2 size={12} className="animate-spin" /> : null}
                            {queryFeedback.state === 'timeout' ? <Clock3 size={12} /> : null}
                            {queryFeedback.state === 'error' ? <AlertTriangle size={12} /> : null}
                            {queryFeedback.state === 'success' || queryFeedback.state === 'empty' || queryFeedback.state === 'message' ? <CheckCircle2 size={12} /> : null}
                            <span>{queryFeedback.summary}</span>
                        </div>
                    ) : null}
                </div>
                <div className="section-header-right">
                    {!resultCollapsed && activeSavedResult ? (
                        <button
                            type="button"
                            className="export-button result-secondary-action"
                            onClick={handleFillSavedSql}
                            title="回填 SQL 到编辑器"
                        >
                            <Code2 size={14} />
                            <span>回填 SQL</span>
                        </button>
                    ) : null}
                    {!resultCollapsed && shouldShowExportTasksButton && canExport ? (
                        <div className="export-wrapper" ref={exportTasksMenuRef}>
                            <button
                                className={`export-button export-tasks-button ${showExportTasksMenu ? 'is-active' : ''}`.trim()}
                                onClick={() => {
                                    setShowExportMenu(false);
                                    setShowExportTasksMenu((visible) => !visible);
                                }}
                                title="查看导出任务"
                                aria-haspopup="dialog"
                                aria-expanded={showExportTasksMenu}
                            >
                                {loadingExportTasks && showExportTasksMenu ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                                <span>导出任务</span>
                                {activeExportTaskCount > 0 ? <span className="export-task-badge">{activeExportTaskCount}</span> : null}
                            </button>
                            {showExportTasksMenu && (
                                <div className="export-menu export-tasks-menu" role="dialog" aria-label="导出任务">
                                    <div className="export-tasks-header">
                                        <span>后台导出任务</span>
                                        <button
                                            type="button"
                                            className="export-tasks-refresh"
                                            onClick={() => void loadExportTasks()}
                                            disabled={loadingExportTasks}
                                        >
                                            {loadingExportTasks ? '刷新中...' : '刷新'}
                                        </button>
                                    </div>
                                    <div className="export-task-list">
                                        {exportTasks.length === 0 ? (
                                            <div className="export-task-empty">当前没有导出任务。</div>
                                        ) : exportTasks.map((task) => {
                                            const statusMeta = getExportTaskStatusMeta(task.status);
                                            const exportedRowsSummary = task.exportedRows
                                                ? `${task.exportedRows.toLocaleString('zh-CN')} 条`
                                                : null;
                                            const rowLimitSummary = task.truncated && task.rowLimit
                                                ? `已触达 ${task.rowLimit.toLocaleString('zh-CN')} 条上限`
                                                : null;

                                            return (
                                                <div className="export-task-item" key={task.taskId}>
                                                    <div className="export-task-main">
                                                        <div className="export-task-topline">
                                                            <span className="export-task-name">{task.format.toUpperCase()} 导出</span>
                                                            <span className={`export-task-status ${statusMeta.toneClass}`.trim()}>
                                                                {task.status === 'RUNNING' ? <Loader2 size={12} className="animate-spin" /> : null}
                                                                {task.status === 'FAILED' ? <AlertTriangle size={12} /> : null}
                                                                {task.status === 'SUCCESS' ? <CheckCircle2 size={12} /> : null}
                                                                {task.status === 'PENDING' ? <Clock3 size={12} /> : null}
                                                                <span>{statusMeta.label}</span>
                                                            </span>
                                                        </div>
                                                        <div className="export-task-meta">
                                                            <span>{formatTaskTimestamp(task.updatedAt)}</span>
                                                            {exportedRowsSummary ? <span>{exportedRowsSummary}</span> : null}
                                                            {rowLimitSummary ? <span>{rowLimitSummary}</span> : null}
                                                        </div>
                                                        {task.status === 'FAILED' && task.errorMessage ? (
                                                            <p className="export-task-error">{task.errorMessage}</p>
                                                        ) : null}
                                                    </div>
                                                    {task.status === 'SUCCESS' ? (
                                                        <button
                                                            type="button"
                                                            className="export-task-download"
                                                            onClick={() => downloadExportTask(task.taskId)}
                                                        >
                                                            下载
                                                        </button>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : null}
                    {!resultCollapsed && displayedResultHasTable && canExport && (
                        <div className="export-wrapper" ref={exportMenuRef}>
                            <button
                                className="export-button"
                                onClick={() => {
                                    setShowExportTasksMenu(false);
                                    setShowExportMenu((visible) => !visible);
                                }}
                                title="导出结果"
                                aria-haspopup="menu"
                                aria-expanded={showExportMenu}
                                disabled={exportState.status === 'exporting'}
                            >
                                {exportState.status === 'exporting' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                <span>{exportState.status === 'exporting' ? '导出中' : '导出'}</span>
                            </button>
                            {showExportMenu && (
                                <div className="export-menu" role="menu">
                                    <button className="export-menu-item" role="menuitem" onClick={() => void createAsyncExportTask('csv')}>
                                        <FileText size={14} />
                                        <span>导出 CSV</span>
                                    </button>
                                    <button className="export-menu-item" role="menuitem" onClick={() => void createAsyncExportTask('xlsx')}>
                                        <Sheet size={14} />
                                        <span>导出 Excel</span>
                                    </button>
                                    {displayedResult?.truncated ? (
                                        <div className="export-menu-note">
                                            当前页面仅展示前 {displayedResult.rowLimit} 条。导出会按该结果对应 SQL 最多导出 {EXPORT_MAX_ROWS.toLocaleString('zh-CN')} 条。
                                        </div>
                                    ) : null}
                                    {exportState.status !== 'idle' && exportState.message ? (
                                        <div className={`export-menu-feedback ${exportState.status === 'error' ? 'is-error' : ''}`.trim()}>
                                            {exportState.message}
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    )}
                    <TooltipProvider delayDuration={400}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className={`section-toggle-button ${hasHiddenResultHint ? 'has-notice' : ''}`.trim()}
                                    onClick={toggleResultPanel}
                                    aria-label={resultCollapsed ? '展开查询结果' : '收起查询结果'}
                                >
                                    {resultCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    {hasHiddenResultHint ? <span className="sidebar-toggle-notice" aria-hidden="true" /> : null}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="top">
                                {resultCollapsed ? '展开查询结果' : '收起查询结果'} <kbd>{isMac ? '⌘' : 'Ctrl'}+J</kbd>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
            {!resultCollapsed && (
                <div className="results-container">
                    {activeResultTab === 'current' && queryResultLoadingVisible ? (
                        <div className="result-loading-placeholder" aria-live="polite" aria-busy="true">
                            <div className="result-loading-placeholder-line short" />
                            <div className="result-loading-placeholder-line medium" />
                            <div className="result-loading-placeholder-line long" />
                        </div>
                    ) : null}
                    {displayedResultHasRows ? (
                        <>
                            {displayedResult?.truncated ? (
                                <div className="result-limit-notice" role="status" aria-live="polite">
                                    <AlertTriangle size={14} />
                                    <span>当前仅展示前 {displayedResult.rowLimit} 行结果。大表查询建议显式添加 <code>LIMIT</code>。</span>
                                </div>
                            ) : null}
                            <table className="results-table">
                                <thead>
                                    <tr>
                                        {displayedResult?.columns.map(col => (
                                            <th key={col.name}>
                                                <div className="th-content">
                                                    <span className="th-name">{col.name}</span>
                                                    <span className="th-type">{col.type}</span>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayedResult?.rows.map((row, idx) => (
                                        <tr key={idx}>
                                            {displayedResult.columns.map(col => (
                                                <td key={col.name} title={String(row[col.name] ?? '')}>
                                                    {String(row[col.name] ?? '')}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    ) : !(activeResultTab === 'current' && queryResultLoadingVisible) ? (
                        <div className={`result-feedback-card is-${queryFeedback.state}`.trim()}>
                            <div className="result-feedback-icon" aria-hidden="true">
                                {queryFeedback.state === 'timeout' ? <Clock3 size={22} /> : null}
                                {queryFeedback.state === 'error' ? <AlertTriangle size={22} /> : null}
                                {queryFeedback.state === 'message' ? <Info size={22} /> : null}
                                {queryFeedback.state === 'success' || queryFeedback.state === 'empty' ? <CheckCircle2 size={22} /> : null}
                                {queryFeedback.state === 'idle' ? <Code2 size={22} /> : null}
                            </div>
                            <div className="result-feedback-copy">
                                <span className="result-feedback-kicker">{queryFeedback.label}</span>
                                <h3>{queryFeedback.title}</h3>
                                <p>{queryFeedback.description}</p>
                                {activeSavedResult ? (
                                    <div className="result-feedback-meta">
                                        <span>{activeSavedResult.dataSourceName || '未知数据源'}</span>
                                        {activeSavedResult.databaseName ? <span>{activeSavedResult.databaseName}</span> : null}
                                        <span>{formatTaskTimestamp(activeSavedResult.executedAt)}</span>
                                    </div>
                                ) : null}
                                {queryFeedback.state === 'message' && displayedResult?.message ? (
                                    <pre className="result-feedback-detail">{displayedResult.message}</pre>
                                ) : null}
                                {(queryFeedback.state === 'error' || queryFeedback.state === 'timeout') && displayedQueryError ? (
                                    <pre className="result-feedback-detail">{displayedQueryError}</pre>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </div>
            )}
        </section>
    );
}
