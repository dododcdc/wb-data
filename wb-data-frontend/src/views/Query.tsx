import { useEffect, useRef, useMemo, lazy, Suspense, useCallback, useLayoutEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import type { AllotmentHandle } from 'allotment';
import { Play, Loader2, PanelLeftClose, PanelLeft, Star, Wand2 } from 'lucide-react';
import { DataSource } from '../api/datasource';
import { useAuthStore } from '../utils/auth';
import { DataSourceSelect } from '../components/DataSourceSelect';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useQueryEditor } from './query/hooks/useQueryEditor';
import { useQueryExecution } from './query/hooks/useQueryExecution';
import { useKeyboardShortcuts } from './query/hooks/useKeyboardShortcuts';
import { isMac } from './query/queryConstants';
import { QuerySidebar } from './query/components/QuerySidebar';
import { registerEditorThemes } from './query/editorUtils';
import { MonacoEditorInstance } from './query/types';
import { QueryResultsPanel } from './query/components/QueryResultsPanel';
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
        selectedDsId, defaultDsId,
        dsKeyword, loadingDs, loadingDsMore, dsHasMore,
        selectedDsOption, dataSourceOptions,
        setDsKeyword, setSelectedDb,
        applySelectedDataSource, loadMoreDataSources, toggleDefaultDataSource, getActiveDataSource,
        databases, selectedDb, dbKeyword, loadingDatabases,
        databaseOptions, selectedDbOption, setDbKeyword,
        tables, tableKeyword, tableTotal,
        loadingTables, loadingMoreTables, expandedTables,
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

    const editorRef = useRef<MonacoEditorInstance | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);


    const execution = useQueryExecution({
        sql, result, queryError, loadingQuery,
        setSql, setResult, setQueryError, setLoadingQuery,
        selectedDsId, selectedDb, getActiveDataSource,
        resultAutoOpen, resultCollapsed, setResultPanelState,
        editorRef, monacoRef,
    });

    const {
        showExportMenu, setShowExportMenu,
        showExportTasksMenu, setShowExportTasksMenu,
        exportMenuRef, exportTasksMenuRef,
        exportState, exportTasks, loadingExportTasks,
        activeExportTaskCount, shouldShowExportTasksButton,
        savedResults, activeResultTab, setActiveResultTab, currentResultTabNumber,
        activeSavedResult, hasCurrentResultTab,
        displayedResult, displayedQueryError, currentResultCanPin,
        handleRunQuery, handleFormat, handlePinCurrentResult,
        handleCloseSavedResult, handleToggleSavedResultPin, handleFillSavedSql,
        createAsyncExportTask, downloadExportTask, loadExportTasks,
    } = execution;

    const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
    const horizontalSplitterRef = useRef<AllotmentHandle | null>(null);
    const verticalSplitterRef = useRef<AllotmentHandle | null>(null);
    const horizontalLayoutSizesRef = useRef<number[] | null>(null);
    const verticalLayoutSizesRef = useRef<number[] | null>(null);
    const querySplitterRef = useRef<HTMLDivElement | null>(null);
    const queryContentRef = useRef<HTMLDivElement | null>(null);

    const queryLoadingVisible = useDelayedBusy(loadingQuery, { delayMs: 0, minVisibleMs: 420 });
    const queryResultLoadingVisible = useDelayedBusy(loadingQuery && !result && !queryError, { delayMs: 120, minVisibleMs: 280 });









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




    useKeyboardShortcuts({
        onToggleSidebar: toggleSidebar,
        onToggleResultPanel: toggleResultPanel,
    });






    const hasHiddenMetadataHint =
        sidebarCollapsed &&
        Boolean(selectedDsId && selectedDb) &&
        (loadingTables || loadingMoreTables || tableTotal > 0);

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
                    <QuerySidebar
                        sidebarCollapsed={sidebarCollapsed}
                        selectedDsId={selectedDsId}
                        selectedDb={selectedDb}
                        tableTotal={tableTotal}
                        tableKeyword={tableKeyword}
                        setTableKeyword={setTableKeyword}
                        setTableKeywordCommitted={setTableKeywordCommitted}
                        loadingTables={loadingTables}
                        tables={tables}
                        loadingMoreTables={loadingMoreTables}
                        expandedTables={expandedTables}
                        columnCache={columnCache}
                        loadingColumns={loadingColumns}
                        toggleTableExpand={toggleTableExpand}
                        handleTableScrollRef={handleTableScrollRef}
                        tableScrollElement={tableScrollElement}
                        handleTableScroll={handleTableScroll}
                    />
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
                            <QueryResultsPanel
                                resultCollapsed={resultCollapsed}
                                toggleResultPanel={toggleResultPanel}
                                activeResultTab={activeResultTab}
                                setActiveResultTab={setActiveResultTab}
                                savedResults={savedResults}
                                currentResultTabNumber={currentResultTabNumber}
                                activeSavedResult={activeSavedResult}
                                hasCurrentResultTab={hasCurrentResultTab}
                                displayedResult={displayedResult}
                                displayedQueryError={displayedQueryError}
                                currentResultCanPin={currentResultCanPin}
                                loadingQuery={loadingQuery}
                                queryResultLoadingVisible={queryResultLoadingVisible}
                                canExport={canExport}
                                exportState={exportState}
                                exportTasks={exportTasks}
                                loadingExportTasks={loadingExportTasks}
                                activeExportTaskCount={activeExportTaskCount}
                                shouldShowExportTasksButton={shouldShowExportTasksButton}
                                showExportMenu={showExportMenu}
                                setShowExportMenu={setShowExportMenu}
                                showExportTasksMenu={showExportTasksMenu}
                                setShowExportTasksMenu={setShowExportTasksMenu}
                                exportMenuRef={exportMenuRef}
                                exportTasksMenuRef={exportTasksMenuRef}
                                handlePinCurrentResult={handlePinCurrentResult}
                                handleCloseSavedResult={handleCloseSavedResult}
                                handleToggleSavedResultPin={handleToggleSavedResultPin}
                                handleFillSavedSql={handleFillSavedSql}
                                createAsyncExportTask={createAsyncExportTask}
                                downloadExportTask={downloadExportTask}
                                loadExportTasks={loadExportTasks}
                            />
                        </Allotment.Pane>
                    </Allotment>
                    </div>
                </Allotment.Pane>
            </Allotment>
        </div>
    );
}
