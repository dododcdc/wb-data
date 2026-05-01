import { useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import type { AllotmentHandle } from 'allotment';
import { useAuthStore } from '../../utils/auth';



import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useQueryEditor } from './hooks/useQueryEditor';
import { useQueryExecution } from './hooks/useQueryExecution';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { isMac } from './queryConstants';
import { QuerySidebar } from './components/QuerySidebar';
import { QueryToolbar } from './components/QueryToolbar';
import { QueryEditor } from './components/QueryEditor';
import { MonacoEditorInstance } from './types';
import { QueryResultsPanel } from './components/QueryResultsPanel';
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
} from './hooks/useLayoutPersistence';
import { useSqlCompletion } from './hooks/useSqlCompletion';
import { useMetadata } from './hooks/useMetadata';
import { useKeyboardFocusMode } from '../../hooks/useKeyboardFocusMode';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { setupQueryEditorActions } from './queryEditorActions';
import './Query.css';




export default function Query() {
    useKeyboardFocusMode();
    const { showFeedback } = useOperationFeedback();

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
        showFeedback,
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
    const queryEditorActionsDisposeRef = useRef<(() => void) | null>(null);
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
        monacoRef.current = monaco;
        editorRef.current = editor;

        // Register custom completion provider for SQL (scene-owned)
        completionProviderRef.current?.dispose();
        completionProviderRef.current = registerCompletionProvider(monaco);

        // Register query-specific actions (Cmd/Ctrl+Enter for execution)
        queryEditorActionsDisposeRef.current?.();
        queryEditorActionsDisposeRef.current = setupQueryEditorActions(monaco, editor, {
            onExecute: (sql?: string) => {
                handleRunQueryRef.current(sql);
            },
            getStatementAtCursor: (ed) => getStatementAtCursorRef.current(ed),
        });
    };

    useEffect(() => {
        return () => {
            queryEditorActionsDisposeRef.current?.();
            queryEditorActionsDisposeRef.current = null;
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
                    <QueryToolbar
                        sidebarCollapsed={sidebarCollapsed}
                        hasHiddenMetadataHint={hasHiddenMetadataHint}
                        toggleSidebar={toggleSidebar}
                        isMac={isMac}
                        selectedDsId={selectedDsId}
                        defaultDsId={defaultDsId}
                        toggleDefaultDataSource={toggleDefaultDataSource}
                        dataSourceOptions={dataSourceOptions}
                        selectedDsOption={selectedDsOption}
                        applySelectedDataSource={applySelectedDataSource}
                        setDsKeyword={setDsKeyword}
                        loadingDs={loadingDs}
                        loadingDsMore={loadingDsMore}
                        dsHasMore={dsHasMore}
                        loadMoreDataSources={loadMoreDataSources}
                        dsKeyword={dsKeyword}
                        databaseOptions={databaseOptions}
                        selectedDb={selectedDb}
                        selectedDbOption={selectedDbOption}
                        setSelectedDb={setSelectedDb}
                        setDbKeyword={setDbKeyword}
                        loadingDatabases={loadingDatabases}
                        dbKeyword={dbKeyword}
                        handleFormat={handleFormat}
                        handleRunQuery={handleRunQuery}
                        queryLoadingVisible={queryLoadingVisible}
                    />

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
                            <QueryEditor sql={sql} setSql={setSql} handleEditorDidMount={handleEditorDidMount} />
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
