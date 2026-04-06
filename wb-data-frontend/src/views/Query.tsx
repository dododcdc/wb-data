import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback, useLayoutEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import type { AllotmentHandle } from 'allotment';
import { Play, Loader2, Code2, Wand2, Download, FileText, Sheet, Database, ChevronRight, ChevronDown, ChevronUp, Search, PanelLeftClose, PanelLeft, Star, AlertTriangle, CheckCircle2, Clock3, Info, Pin, X } from 'lucide-react';
import {
    executeQuery,
    createQueryExportTask,
    listQueryExportTasks,
    getQueryExportTaskDownloadUrl,
    QueryExportTask,
} from '../api/query';
import { DataSource } from '../api/datasource';
import { useAuthStore, getToken } from '../utils/auth';
import { DataSourceSelect } from '../components/DataSourceSelect';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useQueryEditor } from './query/hooks/useQueryEditor';
import { useKeyboardShortcuts } from './query/hooks/useKeyboardShortcuts';
import {
    isMac,
    QUERY_EXECUTION_TIMEOUT_MS,
    PINNED_RESULT_LIMIT,
    EXPORT_TASK_POLL_INTERVAL_MS,
    EXPORT_MAX_ROWS,
} from './query/queryConstants';
import {
    upsertExportTask,
    getExportTaskStatusMeta,
    formatTaskTimestamp,
    formatResultTabLabel,
} from './query/exportUtils';
import { registerEditorThemes } from './query/editorUtils';
import { buildQueryFeedback } from './query/feedbackUtils';
import {
    QueryEditorError,
    ExportState,
    SavedQueryResult,
    ResultTabId,
    MonacoEditorInstance,
} from './query/types';
import {
    useLayoutPersistence,
    getHorizontalSizes,
    getVerticalSizes,
    SIDEBAR_DEFAULT_WIDTH_PX,
    SIDEBAR_MIN_WIDTH_PX,
    SIDEBAR_MAX_WIDTH_PX,
    QUERY_MAIN_MIN_WIDTH_PX,
    QUERY_MAIN_DEFAULT_WIDTH_PX,
    RESULT_PANEL_COLLAPSED_HEIGHT_PX,
    RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX,
    RESULT_PANEL_DEFAULT_HEIGHT_PX,
    QUERY_EDITOR_DEFAULT_HEIGHT_PX,
} from './query/hooks/useLayoutPersistence';
import { useSqlCompletion } from './query/hooks/useSqlCompletion';
import { useMetadata } from './query/hooks/useMetadata';
import { useKeyboardFocusMode } from '../hooks/useKeyboardFocusMode';
import { useDelayedBusy } from '../hooks/useDelayedBusy';
import { loadQueryEditorModule } from './queryEditorModule';
import './Query.css';

// Lazy load Monaco Editor for performance (~3MB savings on initial load)
const Editor = lazy(loadQueryEditorModule);

function EditorLoader() {
    return (
        <div className="editor-loader" aria-hidden="true">
            <div className="editor-loader-pulse">
                <span className="editor-loader-pulse-dot" />
                <span className="editor-loader-pulse-dot" />
                <span className="editor-loader-pulse-dot" />
            </div>
        </div>
    );
}



export default function Query() {
    useKeyboardFocusMode();

    const currentGroup = useAuthStore((s) => s.currentGroup);
    const permissions = useAuthStore((s) => s.permissions);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);
    const canExport = systemAdmin || permissions.includes('query.export');
    const groupId = currentGroup?.id;

    // ---- Metadata (data sources, databases, tables, columns, dialect) ----
    const metadata = useMetadata(groupId);
    const {
        dataSources, selectedDsId, selectedDs, defaultDsId,
        dsKeyword, loadingDs, loadingDsMore, dsHasMore,
        selectedDsOption, dataSourceOptions,
        setDsKeyword, setSelectedDb,
        applySelectedDataSource, loadMoreDataSources, toggleDefaultDataSource, getActiveDataSource,
        databases, selectedDb, dbKeyword, loadingDatabases,
        filteredDatabases, databaseOptions, selectedDbOption, setDbKeyword,
        tables, tableKeyword, tableKeywordCommitted, tableTotal,
        loadingTables, loadingMoreTables, tableHasMore, expandedTables,
        setTableKeyword, setTableKeywordCommitted,
        handleTableScroll, handleTableScrollRef, toggleTableExpand, tableScrollElement,
        columnCache, loadingColumns, loadColumns,
        dialectMetadata,
        activeDsIdRef, activeDbRef,
    } = metadata;

    // ---- Layout state ----
    const layout = useLayoutPersistence();
    const {
        sidebarCollapsed, sidebarExpandedWidth, sidebarTransitioning,
        resultCollapsed, resultExpandedHeight, resultAutoOpen, resultTransitioning,
        toggleSidebar, setSidebarWidth, toggleResultPanel, setResultPanelState,
        setResultExpandedHeight,
    } = layout;
    const initialHorizontalSizes = useMemo(() => getHorizontalSizes(sidebarCollapsed, sidebarExpandedWidth), [sidebarCollapsed, sidebarExpandedWidth]);
    const initialVerticalSizes = useMemo(() => getVerticalSizes(resultCollapsed, resultExpandedHeight), [resultCollapsed, resultExpandedHeight]);

    // ---- SQL editor state ----
    const {
        sql, result, queryError, loadingQuery,
        setSql, setResult, setQueryError, setLoadingQuery,
    } = useQueryEditor();

    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showExportTasksMenu, setShowExportTasksMenu] = useState(false);
    const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });
    const [exportTasks, setExportTasks] = useState<QueryExportTask[]>([]);
    const [loadingExportTasks, setLoadingExportTasks] = useState(false);
    const [lastExecutedSql, setLastExecutedSql] = useState('');
    const [lastExecutedDataSourceId, setLastExecutedDataSourceId] = useState('');
    const [lastExecutedDataSourceName, setLastExecutedDataSourceName] = useState('');
    const [lastExecutedDatabase, setLastExecutedDatabase] = useState('');
    const [savedResults, setSavedResults] = useState<SavedQueryResult[]>([]);
    const [activeResultTab, setActiveResultTab] = useState<ResultTabId>('current');
    const [currentResultTabNumber, setCurrentResultTabNumber] = useState<number | null>(null);
    const editorRef = useRef<MonacoEditorInstance | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    const composingRef = useRef(false);
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const exportTasksMenuRef = useRef<HTMLDivElement>(null);
    const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
    const horizontalSplitterRef = useRef<AllotmentHandle | null>(null);
    const verticalSplitterRef = useRef<AllotmentHandle | null>(null);
    const horizontalLayoutSizesRef = useRef<number[] | null>(null);
    const verticalLayoutSizesRef = useRef<number[] | null>(null);
    const querySplitterRef = useRef<HTMLDivElement | null>(null);
    const queryContentRef = useRef<HTMLDivElement | null>(null);
    const exportStateTimerRef = useRef<number | null>(null);
    const resultTabSequenceRef = useRef(1);

    const queryLoadingVisible = useDelayedBusy(loadingQuery, { delayMs: 0, minVisibleMs: 420 });
    const queryResultLoadingVisible = useDelayedBusy(loadingQuery && !result && !queryError, { delayMs: 120, minVisibleMs: 280 });
    const activeExportTaskCount = useMemo(() => {
        return exportTasks.filter((task) => task.status === 'PENDING' || task.status === 'RUNNING').length;
    }, [exportTasks]);
    const shouldShowExportTasksButton = exportTasks.length > 0 || loadingExportTasks;
    const activeSavedResult = useMemo(() => {
        if (activeResultTab === 'current') {
            return null;
        }
        return savedResults.find((item) => item.id === activeResultTab) ?? null;
    }, [activeResultTab, savedResults]);
    const hasCurrentResultTab = currentResultTabNumber !== null;
    const displayedCurrentResult = hasCurrentResultTab ? result : null;
    const displayedResult = activeSavedResult?.result ?? displayedCurrentResult;
    const displayedQueryError = activeSavedResult ? '' : (hasCurrentResultTab ? queryError : '');
    const currentResultCanPin = Boolean(result && result.columns.length > 0 && !queryError && savedResults.length < PINNED_RESULT_LIMIT);
    const activeResultSql = activeSavedResult?.sql ?? (hasCurrentResultTab ? lastExecutedSql : '');
    const activeResultDataSourceId = activeSavedResult?.dataSourceId ?? (hasCurrentResultTab ? lastExecutedDataSourceId : '');
    const activeResultDatabase = activeSavedResult?.databaseName ?? (hasCurrentResultTab ? lastExecutedDatabase : '');

    const virtualizer = useVirtualizer({
        count: tables.length,
        getScrollElement: () => tableScrollElement,
        estimateSize: () => 36,
        overscan: 10,
    });




    const showExportFeedback = useCallback((nextState: ExportState) => {
        if (exportStateTimerRef.current !== null) {
            window.clearTimeout(exportStateTimerRef.current);
            exportStateTimerRef.current = null;
        }

        setExportState(nextState);

        if (nextState.status === 'error') {
            exportStateTimerRef.current = window.setTimeout(() => {
                setExportState({ status: 'idle' });
                exportStateTimerRef.current = null;
            }, 2800);
        }
    }, []);

    const loadExportTasks = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        if (!silent) {
            setLoadingExportTasks(true);
        }

        try {
            const tasks = await listQueryExportTasks();
            setExportTasks(tasks);
        } catch {
            if (!silent) {
                showExportFeedback({
                    status: 'error',
                    message: '导出任务列表加载失败，请稍后重试。',
                });
            }
        } finally {
            if (!silent) {
                setLoadingExportTasks(false);
            }
        }
    }, [showExportFeedback]);


    const getCurrentHorizontalTotalWidth = useCallback(() => {
        const cachedSizes = horizontalLayoutSizesRef.current;
        if (cachedSizes && cachedSizes.length === 2) {
            const total = cachedSizes[0] + cachedSizes[1];
            if (Number.isFinite(total) && total > 0) {
                return total;
            }
        }

        const measuredWidth = querySplitterRef.current?.clientWidth;
        if (typeof measuredWidth === 'number' && measuredWidth > 0) {
            return measuredWidth;
        }

        return QUERY_MAIN_DEFAULT_WIDTH_PX;
    }, []);

    const getCurrentVerticalTotalHeight = useCallback(() => {
        const cachedSizes = verticalLayoutSizesRef.current;
        if (cachedSizes && cachedSizes.length === 2) {
            const total = cachedSizes[0] + cachedSizes[1];
            if (Number.isFinite(total) && total > 0) {
                return total;
            }
        }

        const measuredHeight = queryContentRef.current?.clientHeight;
        if (typeof measuredHeight === 'number' && measuredHeight > 0) {
            return measuredHeight;
        }

        return QUERY_EDITOR_DEFAULT_HEIGHT_PX + RESULT_PANEL_DEFAULT_HEIGHT_PX;
    }, []);

    useLayoutEffect(() => {
        const nextSizes = getHorizontalSizes(
            sidebarCollapsed,
            sidebarExpandedWidth,
            getCurrentHorizontalTotalWidth(),
        );
        horizontalLayoutSizesRef.current = nextSizes;
        horizontalSplitterRef.current?.resize(nextSizes);
    }, [getCurrentHorizontalTotalWidth, sidebarCollapsed, sidebarExpandedWidth]);

    useLayoutEffect(() => {
        const nextSizes = getVerticalSizes(
            resultCollapsed,
            resultExpandedHeight,
            getCurrentVerticalTotalHeight(),
        );
        verticalLayoutSizesRef.current = nextSizes;
        verticalSplitterRef.current?.resize(nextSizes);
    }, [getCurrentVerticalTotalHeight, resultCollapsed, resultExpandedHeight]);


    useEffect(() => {
        return () => {
            if (exportStateTimerRef.current !== null) {
                window.clearTimeout(exportStateTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        void loadExportTasks({ silent: true });
    }, [loadExportTasks]);

    useEffect(() => {
        if (activeExportTaskCount === 0) return;

        const timer = window.setInterval(() => {
            void loadExportTasks({ silent: true });
        }, EXPORT_TASK_POLL_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [activeExportTaskCount, loadExportTasks]);

    useKeyboardShortcuts({
        onToggleSidebar: toggleSidebar,
        onToggleResultPanel: toggleResultPanel,
    });


    // Close export menu on backdrop click or Escape
    useEffect(() => {
        if (resultCollapsed) {
            setShowExportMenu(false);
            setShowExportTasksMenu(false);
            return;
        }
        if (!showExportMenu && !showExportTasksMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            const clickedInsideExportMenu = exportMenuRef.current?.contains(target);
            const clickedInsideExportTasksMenu = exportTasksMenuRef.current?.contains(target);
            if (!clickedInsideExportMenu && !clickedInsideExportTasksMenu) {
                setShowExportMenu(false);
                setShowExportTasksMenu(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowExportMenu(false);
                setShowExportTasksMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [resultCollapsed, showExportMenu, showExportTasksMenu]);

    useEffect(() => {
        if (!showExportTasksMenu) {
            return;
        }

        void loadExportTasks();
    }, [loadExportTasks, showExportTasksMenu]);



    const hasHiddenMetadataHint =
        sidebarCollapsed &&
        Boolean(selectedDsId && selectedDb) &&
        (loadingTables || loadingMoreTables || tableTotal > 0);

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

    const handleRunQuery = useCallback(async (sqlToRun?: string) => {
        let finalSql = sqlToRun;

        // If no explicit SQL provided (e.g. from button click), check for selection
        const editor = editorRef.current;
        const monacoInstance = monacoRef.current;

        if (!finalSql) {
            // Try to get SQL from editor
            if (editor) {
                const selection = editor.getSelection();
                if (selection && !selection.isEmpty()) {
                    finalSql = editor.getModel()?.getValueInRange(selection);
                } else {
                    finalSql = editor.getModel()?.getValue() ?? '';
                }
            } else if (monacoInstance) {
                // Fallback: try to get from Monaco global
                const editors = monacoInstance.editor.getEditors();
                if (editors.length > 0) {
                    finalSql = editors[0].getModel()?.getValue() ?? '';
                }
            }
        }

        // Fallback to hook's sql state
        finalSql = finalSql ?? sql;

        if (!selectedDsId) {
            setResult(null);
            setQueryError('请先选择数据源后再执行 SQL。');
            setResultPanelState(false);
            return;
        }
        if (!finalSql.trim()) {
            setResult(null);
            setQueryError('请输入 SQL 语句后再执行。');
            setResultPanelState(false);
            return;
        }

        if (currentResultTabNumber === null) {
            setCurrentResultTabNumber(resultTabSequenceRef.current++);
        }

        setResult(null);
        setQueryError('');
        setActiveResultTab('current');
        showExportFeedback({ status: 'idle' });
        setShowExportMenu(false);
        setShowExportTasksMenu(false);
        if (resultAutoOpen) {
            setResultPanelState(false);
        }
        setLoadingQuery(true);
        try {
            const data = await executeQuery(Number(selectedDsId), finalSql, selectedDb);
            const activeDataSource = getActiveDataSource();
            setResult(data);
            setLastExecutedSql(finalSql.trim());
            setLastExecutedDataSourceId(selectedDsId);
            setLastExecutedDataSourceName(activeDataSource?.name || '');
            setLastExecutedDatabase(selectedDb);
            setQueryError('');
        } catch (error: unknown) {
            const requestError = error as QueryEditorError;
            const rawMessage = requestError.response?.data?.message
                || requestError.message
                || '执行查询失败';
            const isTimeoutError =
                requestError.code === 'ECONNABORTED'
                || rawMessage.toLowerCase().includes('timeout')
                || rawMessage.includes('超时');
            const message = isTimeoutError
                ? `查询超过 ${QUERY_EXECUTION_TIMEOUT_MS / 1000} 秒未完成，请检查 SQL 或数据源响应情况。`
                : rawMessage;
            setQueryError(message);
            setResultPanelState(false);
        } finally {
            setLoadingQuery(false);
        }
    }, [currentResultTabNumber, getActiveDataSource, resultAutoOpen, selectedDb, selectedDsId, setResultPanelState, showExportFeedback, sql]);

    // ── SQL Formatting ──────────────────────────────────────────────────────
    const handleFormat = async () => {
        if (!editorRef.current) return;
        const raw = editorRef.current.getValue();
        try {
            const { format } = await import('sql-formatter');
            const formatted = format(raw, { language: 'sql', tabWidth: 4, keywordCase: 'upper' });
            editorRef.current.setValue(formatted);
        } catch {
            // If sql-formatter can't parse it, leave as-is
        }
    };

    const handlePinCurrentResult = useCallback(() => {
        if (!result || queryError || !lastExecutedSql || !lastExecutedDataSourceId || savedResults.length >= PINNED_RESULT_LIMIT || currentResultTabNumber === null) {
            return;
        }

        const executedAt = new Date().toISOString();
        const savedResult: SavedQueryResult = {
            id: `pinned-${Date.now()}-${currentResultTabNumber}`,
            tabNumber: currentResultTabNumber,
            isPinned: true,
            sql: lastExecutedSql,
            dataSourceId: lastExecutedDataSourceId,
            dataSourceName: lastExecutedDataSourceName,
            databaseName: lastExecutedDatabase,
            executedAt,
            rowCount: result.rows.length,
            executionTimeMs: result.executionTimeMs,
            result,
        };

        setSavedResults((currentResults) => [...currentResults, savedResult]);
        setCurrentResultTabNumber(null);
        setActiveResultTab(savedResult.id);
        setShowExportMenu(false);
        setShowExportTasksMenu(false);
    }, [
        currentResultTabNumber,
        lastExecutedDataSourceId,
        lastExecutedDataSourceName,
        lastExecutedDatabase,
        lastExecutedSql,
        savedResults.length,
        queryError,
        result,
    ]);

    const handleCloseSavedResult = useCallback((tabId: string) => {
        setSavedResults((currentResults) => {
            const nextResults = currentResults.filter((item) => item.id !== tabId);
            setActiveResultTab((currentTab) => {
                if (currentTab !== tabId) {
                    return currentTab;
                }
                if (hasCurrentResultTab) {
                    return 'current';
                }
                return nextResults[0]?.id ?? 'current';
            });
            return nextResults;
        });
        setShowExportMenu(false);
    }, [hasCurrentResultTab]);

    const handleToggleSavedResultPin = useCallback((tabId: string) => {
        setSavedResults((currentResults) => currentResults.map((item) => (
            item.id === tabId ? { ...item, isPinned: !item.isPinned } : item
        )));
    }, []);

    const handleFillSavedSql = useCallback(() => {
        if (!activeSavedResult) {
            return;
        }

        setSql(activeSavedResult.sql);
        editorRef.current?.focus();
    }, [activeSavedResult]);

    // ── Result Export ────────────────────────────────────────────────────────
    const createAsyncExportTask = useCallback(async (format: 'csv' | 'xlsx') => {
        if (!activeResultDataSourceId || !activeResultSql) {
            showExportFeedback({ status: 'error', format, message: '请先成功执行查询后再创建导出任务。' });
            return;
        }

        const formatLabel = format === 'csv' ? 'CSV' : 'Excel';
        showExportFeedback({ status: 'exporting', format, message: `正在创建 ${formatLabel} 导出任务...` });
        try {
            const task = await createQueryExportTask(
                Number(activeResultDataSourceId),
                activeResultSql,
                activeResultDatabase || undefined,
                format,
            );
            setExportTasks((currentTasks) => upsertExportTask(currentTasks, task));
            setShowExportMenu(false);
            setShowExportTasksMenu(true);
            showExportFeedback({ status: 'idle' });
            void loadExportTasks({ silent: true });
        } catch (error: unknown) {
            const requestError = error as QueryEditorError;
            showExportFeedback({
                status: 'error',
                format,
                message: requestError.response?.data?.message || requestError.message || `${formatLabel} 导出任务创建失败，请重试。`,
            });
        }
    }, [activeResultDataSourceId, activeResultDatabase, activeResultSql, loadExportTasks, showExportFeedback]);

    const downloadExportTask = useCallback(async (taskId: string) => {
        try {
            const response = await fetch(getQueryExportTaskDownloadUrl(taskId), {
                headers: {
                    Authorization: `Bearer ${getToken()}`,
                },
            });
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download error:', err);
        }
    }, []);

    /**
     * Extracts the SQL statement the cursor is currently on.
     * Splits the full text by semicolons and finds the segment that contains
     * the cursor's character offset position — like DataGrip.
     */
    const getStatementAtCursor = useCallback((editor: MonacoEditorInstance): string => {
        const model = editor.getModel();
        const position = editor.getPosition();
        if (!model || !position) return sql;

        const fullText = model.getValue();
        const cursorOffset = model.getOffsetAt(position);

        // Split statements by semicolons
        const stmts: { start: number; end: number; text: string }[] = [];
        let start = 0;
        for (let i = 0; i <= fullText.length; i++) {
            if (i === fullText.length || fullText[i] === ';') {
                const text = fullText.slice(start, i).trim();
                if (text) stmts.push({ start, end: i, text });
                start = i + 1;
            }
        }

        // Find the statement where the cursor is
        for (const stmt of stmts) {
            if (cursorOffset >= stmt.start && cursorOffset <= stmt.end + 1) {
                return stmt.text;
            }
        }

        // Fallback: return the full SQL
        return fullText.trim();
    }, [sql]);

    const handleRunQueryRef = useRef(handleRunQuery);
    useEffect(() => {
        handleRunQueryRef.current = handleRunQuery;
    }, [handleRunQuery]);

    const getStatementAtCursorRef = useRef(getStatementAtCursor);
    useEffect(() => {
        getStatementAtCursorRef.current = getStatementAtCursor;
    }, [getStatementAtCursor]);


    const { registerCompletionProvider } = useSqlCompletion({
        tables,
        databases,
        columnCache,
        dialectMetadata,
        activeDsId: activeDsIdRef.current,
        activeDb: activeDbRef.current,
        loadColumns,
    });

    const handleEditorDidMount = (editor: MonacoEditorInstance, monaco: typeof Monaco) => {
        registerEditorThemes(monaco);
        monacoRef.current = monaco;
        monaco.editor.setTheme('warm-parchment');
        editorRef.current = editor;

        // Register custom completion provider for SQL
        completionProviderRef.current?.dispose();
        completionProviderRef.current = registerCompletionProvider(monaco);

        // Add Cmd+Enter / Ctrl+Enter: run selection if exists, else only the statement under the cursor
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const selection = editor.getSelection();
            if (selection && !selection.isEmpty()) {
                const selectedText = editor.getModel()?.getValueInRange(selection);
                handleRunQueryRef.current(selectedText);
            } else {
                const stmt = getStatementAtCursorRef.current(editor);
                handleRunQueryRef.current(stmt);
            }
        });

        // Add Shift+Alt+F (Win/Linux) or Shift+Cmd+F (Mac): format SQL
        const formatKeybinding = isMac
            ? monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF
            : monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF;
        editor.addAction({
            id: 'format-sql',
            label: 'Format SQL',
            keybindings: [formatKeybinding],
            run: () => handleFormat(),
        });
    };

    useEffect(() => {
        return () => {
            completionProviderRef.current?.dispose();
            completionProviderRef.current = null;
        };
    }, []);

    return (
        <div
            ref={querySplitterRef}
            className={`query-splitter h-full flex w-full ${sidebarTransitioning ? 'sidebar-transitioning' : ''}`.trim()}
        >
            <Allotment
                ref={horizontalSplitterRef}
                className="query-splitter-panel"
                defaultSizes={initialHorizontalSizes}
                onChange={(sizes) => {
                    horizontalLayoutSizesRef.current = sizes;
                }}
                onDragEnd={(sizes) => {
                    horizontalLayoutSizesRef.current = sizes;
                    const sidebarSize = sizes[0];
                    if (typeof sidebarSize === 'number' && sidebarSize > 0) {
                        setSidebarWidth(sidebarSize);
                    }
                }}
                onVisibleChange={(index, visible) => {
                    if (index === 0) {
                        const nextCollapsed = !visible;
                        if (nextCollapsed !== sidebarCollapsed) {
                            toggleSidebar();
                        }
                    }
                }}
            >
                {/* 左侧元数据面板 */}
                <Allotment.Pane
                    preferredSize={SIDEBAR_DEFAULT_WIDTH_PX}
                    minSize={SIDEBAR_MIN_WIDTH_PX}
                    maxSize={SIDEBAR_MAX_WIDTH_PX}
                    visible={!sidebarCollapsed}
                    className="metadata-panel-wrapper"
                >
                    <aside className={`metadata-panel ${sidebarCollapsed ? 'sidebar-hidden' : 'sidebar-visible'}`}>
                        <div className="metadata-header">
                            <span className="metadata-title">表结构</span>
                            {selectedDsId && selectedDb && tableTotal > 0 && (
                                <span className="metadata-total-count">共 {tableTotal} 张表</span>
                            )}
                        </div>
                        {selectedDsId && selectedDb && (
                            <div className="metadata-search">
                                <Search size={14} className="metadata-search-icon" />
                                <input
                                    type="text"
                                    className="metadata-search-input"
                                    aria-label="搜索表名"
                                    placeholder="搜索表名..."
                                    value={tableKeyword}
                                    onChange={(e) => {
                                        setTableKeyword(e.target.value);
                                        if (!composingRef.current) {
                                            setTableKeywordCommitted(e.target.value);
                                        }
                                    }}
                                    onCompositionStart={() => { composingRef.current = true; }}
                                    onCompositionEnd={(e) => {
                                        composingRef.current = false;
                                        const val = (e.target as HTMLInputElement).value;
                                        setTableKeyword(val);
                                        setTableKeywordCommitted(val);
                                    }}
                                />
                            </div>
                        )}
                        <div
                            className="metadata-content"
                            ref={handleTableScrollRef}
                            onScroll={handleTableScroll}
                        >
                            {loadingTables ? (
                                <div className="metadata-empty">
                                    <Loader2 size={24} className="animate-spin" />
                                    <span>加载中...</span>
                                </div>
                            ) : tables.length === 0 ? (
                                <div className="metadata-empty">
                                    <Database size={32} className="metadata-empty-icon" />
                                    <span>{selectedDsId && selectedDb ? (tableKeyword ? '未找到匹配的表' : '该数据库下没有表') : '请先选择数据源和数据库'}</span>
                                </div>
                            ) : (
                                <div
                                    style={{
                                        height: `${virtualizer.getTotalSize()}px`,
                                        width: '100%',
                                        position: 'relative',
                                    }}
                                >
                                    {virtualizer.getVirtualItems().map(virtualRow => {
                                        const table = tables[virtualRow.index];
                                        if (!table) return null;
                                        const isExpanded = expandedTables.has(table.name);
                                        const cols = columnCache.get(table.name);
                                        const isLoadingCols = loadingColumns.has(table.name);
                                        return (
                                            <div
                                                key={table.name}
                                                data-index={virtualRow.index}
                                                ref={virtualizer.measureElement}
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    transform: `translateY(${virtualRow.start}px)`,
                                                }}
                                            >
                                                <div className="metadata-item">
                                                    <button
                                                        type="button"
                                                        className="metadata-item-header"
                                                        onClick={() => toggleTableExpand(table.name)}
                                                        aria-expanded={isExpanded}
                                                        aria-label={`${isExpanded ? '收起' : '展开'} ${table.name} 字段`}
                                                    >
                                                        {isExpanded
                                                            ? <ChevronDown size={14} className="metadata-chevron" />
                                                            : <ChevronRight size={14} className="metadata-chevron" />
                                                        }
                                                        <Database size={14} className="metadata-icon" />
                                                        <span className="metadata-item-name">{table.name}</span>
                                                    </button>
                                                    {isExpanded && (
                                                        <ul className="metadata-columns">
                                                            {isLoadingCols ? (
                                                                <li className="metadata-column-loading">
                                                                    <Loader2 size={12} className="animate-spin" />
                                                                    <span>加载字段...</span>
                                                                </li>
                                                            ) : cols ? (
                                                                <>
                                                                    {cols.slice(0, 50).map(col => (
                                                                        <li key={col.name} className="metadata-column">
                                                                            <span className="column-name">{col.name}</span>
                                                                            <span className="column-type">{col.type}</span>
                                                                        </li>
                                                                    ))}
                                                                    {cols.length > 50 && (
                                                                        <li className="metadata-more">
                                                                            还有 {cols.length - 50} 个字段...
                                                                        </li>
                                                                    )}
                                                                </>
                                                            ) : null}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {loadingMoreTables && (
                                <div className="metadata-loading-more">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>加载更多...</span>
                                </div>
                            )}
                        </div>
                    </aside>
                </Allotment.Pane>

                {/* 右侧主内容区 */}
                <Allotment.Pane minSize={QUERY_MAIN_MIN_WIDTH_PX} preferredSize="100%" className="query-main-wrapper">
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
                                        value={selectedDb}
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

                    <div
                        ref={queryContentRef}
                        className={`query-content-splitter ${resultTransitioning ? 'result-transitioning' : ''}`.trim()}
                    >
                        <Allotment
                            ref={verticalSplitterRef}
                            vertical
                            defaultSizes={initialVerticalSizes}
                            onChange={(sizes) => {
                                verticalLayoutSizesRef.current = sizes;
                            }}
                            onDragEnd={(sizes) => {
                                verticalLayoutSizesRef.current = sizes;
                                const resultPaneSize = sizes[1];
                                if (typeof resultPaneSize === 'number' && resultPaneSize > RESULT_PANEL_COLLAPSED_HEIGHT_PX) {
                                    const nextHeight = Math.max(RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX, Math.round(resultPaneSize));
                                    setResultExpandedHeight(nextHeight);
                                }
                            }}
                        >
                        <Allotment.Pane preferredSize="60%" className="query-editor-wrapper relative">
                            <section className="editor-section">

                                <div className="editor-wrapper">
                                    <Suspense fallback={<EditorLoader />}>
                                        <Editor
                                            height="100%"
                                            language="sql"
                                            theme="warm-parchment"
                                            value={sql}
                                            loading={<EditorLoader />}
                                            onChange={(value: string | undefined) => setSql(value || '')}
                                            onMount={handleEditorDidMount}
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 14,
                                                quickSuggestions: {
                                                    other: true,
                                                    comments: false,
                                                    strings: false,
                                                },
                                                quickSuggestionsDelay: 120,
                                                suggestOnTriggerCharacters: true,
                                                lineNumbers: 'on',
                                                lineNumbersMinChars: 2,
                                                lineDecorationsWidth: 8,
                                                glyphMargin: false,
                                                scrollBeyondLastLine: false,
                                                automaticLayout: true,
                                                padding: { top: 12, bottom: 12 },
                                                fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                                roundedSelection: false,
                                                cursorStyle: 'line',
                                                renderLineHighlight: 'all',
                                            }}
                                        />
                                    </Suspense>
                                </div>
                            </section>
                        </Allotment.Pane>

                        <Allotment.Pane
                            minSize={RESULT_PANEL_COLLAPSED_HEIGHT_PX}
                            preferredSize="40%"
                            className={`query-result-wrapper ${resultCollapsed ? 'is-collapsed' : ''}`.trim()}
                        >
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
                        </Allotment.Pane>
                    </Allotment>
                    </div>
                </Allotment.Pane>
            </Allotment>
        </div>
    );
}
