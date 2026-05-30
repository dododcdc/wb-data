import { useEffect, useRef, useCallback } from 'react';
import type * as Monaco from 'monaco-editor';
import { usePanelRef } from 'react-resizable-panels';
import { useAuthStore } from '../../utils/auth';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '../../components/ui/resizable';
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
        sidebarCollapsed, sidebarTransitioning,
        resultCollapsed, resultAutoOpen, resultTransitioning,
        toggleSidebar, setResultPanelState,
    } = layout;

    const sidebarPanelRef = usePanelRef();
    const resultPanelRef = usePanelRef();

    const handleToggleSidebar = useCallback(() => {
        const panel = sidebarPanelRef.current;
        if (!panel) return;
        if (panel.isCollapsed()) {
            panel.expand();
        } else {
            panel.collapse();
        }
    }, []);

    const handleToggleResultPanel = useCallback(() => {
        const panel = resultPanelRef.current;
        if (!panel) return;
        if (panel.isCollapsed()) {
            panel.expand();
        } else {
            panel.collapse();
        }
    }, []);

    // Sync React state when panel collapses/expands via drag
    const handleSidebarResize = useCallback(() => {
        const isCollapsed = sidebarPanelRef.current?.isCollapsed();
        if (isCollapsed && !sidebarCollapsed) {
            toggleSidebar();
        } else if (!isCollapsed && sidebarCollapsed) {
            toggleSidebar();
        }
    }, [sidebarCollapsed, toggleSidebar]);

    const handleResultResize = useCallback(() => {
        const isCollapsed = resultPanelRef.current?.isCollapsed();
        if (isCollapsed && !resultCollapsed) {
            setResultPanelState(true);
        } else if (!isCollapsed && resultCollapsed) {
            setResultPanelState(false);
        }
    }, [resultCollapsed, setResultPanelState]);

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
    // No longer need manual resizing logic for Allotment





    useKeyboardShortcuts({
        onToggleSidebar: handleToggleSidebar,
        onToggleResultPanel: handleToggleResultPanel,
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

    const queryLoadingVisible = useDelayedBusy(loadingQuery, { delayMs: 0, minVisibleMs: 420 });
    const queryResultLoadingVisible = useDelayedBusy(loadingQuery && !result && !queryError, { delayMs: 120, minVisibleMs: 280 });

    return (
        <div className={`query-page-container h-full w-full flex overflow-hidden ${sidebarTransitioning ? 'sidebar-transitioning' : ''}`}>
            <ResizablePanelGroup 
                direction="horizontal" 
                autoSaveId="query-main-horizontal-layout"
                className="query-splitter h-full"
            >
                {/* 左侧元数据面板 */}
                <ResizablePanel
                    id="sidebar"
                    order={1}
                    defaultSize={20}
                    maxSize={40}
                    collapsible
                    collapsedSize={0}
                    minSize={0}
                    panelRef={sidebarPanelRef}
                    onResize={handleSidebarResize}
                    className={`metadata-panel-wrapper ${sidebarCollapsed ? 'is-collapsed' : ''}`}
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
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* 右侧主内容区 */}
                <ResizablePanel id="main" order={2} defaultSize={80} className="query-main-wrapper flex flex-col">
                    <QueryToolbar
                        sidebarCollapsed={sidebarCollapsed}
                        hasHiddenMetadataHint={hasHiddenMetadataHint}
                        toggleSidebar={handleToggleSidebar}
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

                    <div className="flex-1 min-height-0">
                        <ResizablePanelGroup 
                            direction="vertical" 
                            autoSaveId="query-main-vertical-layout"
                            className={`query-content-splitter ${resultTransitioning ? 'result-transitioning' : ''}`}
                        >
                            <ResizablePanel id="editor" order={1} defaultSize={60} className="query-editor-wrapper relative">
                                <QueryEditor sql={sql} setSql={setSql} handleEditorDidMount={handleEditorDidMount} />
                            </ResizablePanel>

                            <ResizableHandle withHandle />

                            <ResizablePanel
                                id="results"
                                order={2}
                                defaultSize={40}
                                collapsible
                                collapsedSize={0}
                                minSize={0}
                                panelRef={resultPanelRef}
                                onResize={handleResultResize}
                                className={`query-result-wrapper ${resultCollapsed ? 'is-collapsed' : ''}`}
                            >
                                <QueryResultsPanel
                                    resultCollapsed={resultCollapsed}
                                    toggleResultPanel={handleToggleResultPanel}
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
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
