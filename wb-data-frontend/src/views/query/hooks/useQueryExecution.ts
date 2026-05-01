/**
 * 查询执行与导出管理 hook
 * 管理 SQL 执行、结果固定（pin）、异步导出任务等。
 *
 * 从 Query.tsx 提取，整合导出状态、结果标签页管理和执行逻辑。
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type * as Monaco from 'monaco-editor';
import {
    executeQuery,
    createQueryExportTask,
    listQueryExportTasks,
    getQueryExportTaskDownloadUrl,
    QueryExportTask,
} from '../../../api/query';
import { getToken } from '../../../utils/auth';
import {
    QUERY_EXECUTION_TIMEOUT_MS,
    PINNED_RESULT_LIMIT,
    EXPORT_TASK_POLL_INTERVAL_MS,
} from '../queryConstants';
import { upsertExportTask } from '../exportUtils';
import {
    QueryEditorError,
    ExportState,
    SavedQueryResult,
    ResultTabId,
    MonacoEditorInstance,
} from '../types';
import type { DataSource } from '../../../api/datasource';
import type { QueryResult } from '../../../api/query';
import type { FeedbackPayload } from '../../../hooks/useOperationFeedback';

// ==================== Types ====================

interface UseQueryExecutionParams {
    /** Current SQL from editor */
    sql: string;
    /** Current result from useQueryEditor */
    result: QueryResult | null;
    /** Current query error from useQueryEditor */
    queryError: string;
    /** Loading state from useQueryEditor */
    loadingQuery: boolean;
    /** Setters from useQueryEditor */
    setResult: (result: QueryResult | null) => void;
    setQueryError: (error: string) => void;
    setLoadingQuery: (loading: boolean) => void;
    setSql: (sql: string) => void;
    /** Selected data source ID */
    selectedDsId: string;
    /** Selected database */
    selectedDb: string;
    /** Get active data source object */
    getActiveDataSource: () => DataSource | null;
    /** Whether result auto-opens on query run */
    resultAutoOpen: boolean;
    /** Result panel collapsed state */
    resultCollapsed: boolean;
    /** Set result panel state */
    setResultPanelState: (collapsed: boolean) => void;
    /** Editor instance ref */
    editorRef: React.RefObject<MonacoEditorInstance | null>;
    /** Monaco instance ref */
    monacoRef: React.RefObject<typeof Monaco | null>;
    /** Global operation feedback */
    showFeedback: (payload: FeedbackPayload, durationMs?: number) => void;
}

const DOWNLOAD_ERROR_MESSAGE = '导出文件下载失败，请稍后重试。';

async function resolveDownloadErrorMessage(response: Response) {
    const readableResponse = typeof response.clone === 'function' ? response.clone() : response;
    const bodyText = (await readableResponse.text()).trim();
    if (!bodyText) return DOWNLOAD_ERROR_MESSAGE;

    try {
        const data = JSON.parse(bodyText) as { message?: unknown };
        if (typeof data.message === 'string' && data.message.trim()) {
            return data.message.trim();
        }
        return DOWNLOAD_ERROR_MESSAGE;
    } catch {
        return bodyText;
    }
}

// ==================== Hook ====================

export function useQueryExecution(params: UseQueryExecutionParams) {
    const {
        sql,
        result,
        queryError,
        setResult,
        setQueryError,
        setLoadingQuery,
        setSql,
        selectedDsId,
        selectedDb,
        getActiveDataSource,
        resultAutoOpen,
        resultCollapsed,
        setResultPanelState,
        editorRef,
        monacoRef,
        showFeedback,
    } = params;

    // ---- Export state ----
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showExportTasksMenu, setShowExportTasksMenu] = useState(false);
    const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });
    const [exportTasks, setExportTasks] = useState<QueryExportTask[]>([]);
    const [loadingExportTasks, setLoadingExportTasks] = useState(false);

    // ---- Execution tracking ----
    const [lastExecutedSql, setLastExecutedSql] = useState('');
    const [lastExecutedDataSourceId, setLastExecutedDataSourceId] = useState('');
    const [lastExecutedDataSourceName, setLastExecutedDataSourceName] = useState('');
    const [lastExecutedDatabase, setLastExecutedDatabase] = useState('');

    // ---- Result tabs ----
    const [savedResults, setSavedResults] = useState<SavedQueryResult[]>([]);
    const [activeResultTab, setActiveResultTab] = useState<ResultTabId>('current');
    const [currentResultTabNumber, setCurrentResultTabNumber] = useState<number | null>(null);

    // ---- Refs ----
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const exportTasksMenuRef = useRef<HTMLDivElement>(null);
    const exportStateTimerRef = useRef<number | null>(null);
    const resultTabSequenceRef = useRef(1);

    // ==================== Derived values ====================

    const activeExportTaskCount = useMemo(() => {
        return exportTasks.filter((task) => task.status === 'PENDING' || task.status === 'RUNNING').length;
    }, [exportTasks]);

    const shouldShowExportTasksButton = exportTasks.length > 0 || loadingExportTasks;

    const activeSavedResult = useMemo(() => {
        if (activeResultTab === 'current') return null;
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

    // ==================== Export feedback ==================== 

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
        if (!silent) setLoadingExportTasks(true);

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
            if (!silent) setLoadingExportTasks(false);
        }
    }, [showExportFeedback]);

    // ==================== Query execution ====================

    const handleRunQuery = useCallback(async (sqlToRun?: string) => {
        let finalSql = sqlToRun;

        const editor = editorRef.current;
        const monacoInstance = monacoRef.current;

        if (!finalSql) {
            if (editor) {
                const selection = editor.getSelection();
                if (selection && !selection.isEmpty()) {
                    finalSql = editor.getModel()?.getValueInRange(selection);
                } else {
                    finalSql = editor.getModel()?.getValue() ?? '';
                }
            } else if (monacoInstance) {
                const editors = monacoInstance.editor.getEditors();
                if (editors.length > 0) {
                    finalSql = editors[0].getModel()?.getValue() ?? '';
                }
            }
        }

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
    }, [currentResultTabNumber, getActiveDataSource, resultAutoOpen, selectedDb, selectedDsId, setResultPanelState, showExportFeedback, sql, editorRef, monacoRef, setResult, setQueryError, setLoadingQuery]);

    // ==================== SQL formatting ====================

    const handleFormat = useCallback(async () => {
        if (!editorRef.current) return;
        const raw = editorRef.current.getValue();
        const { formatSqlContent } = await import('../../../components/sql-editor/sqlFormatting');
        const formatted = formatSqlContent(raw);
        if (formatted !== raw) {
            editorRef.current.setValue(formatted);
        }
    }, [editorRef]);

    // ==================== Result tab management ====================

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
                if (currentTab !== tabId) return currentTab;
                if (hasCurrentResultTab) return 'current';
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
        if (!activeSavedResult) return;
        setSql(activeSavedResult.sql);
        editorRef.current?.focus();
    }, [activeSavedResult, setSql, editorRef]);

    // ==================== Export operations ====================

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
            if (!response.ok) {
                throw new Error(await resolveDownloadErrorMessage(response));
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '下载失败',
                detail: error instanceof Error && error.message
                    ? error.message
                    : DOWNLOAD_ERROR_MESSAGE,
            });
        }
    }, [showFeedback]);

    // ==================== Effects ====================

    // Clean up export feedback timer
    useEffect(() => {
        return () => {
            if (exportStateTimerRef.current !== null) {
                window.clearTimeout(exportStateTimerRef.current);
            }
        };
    }, []);

    // Load export tasks on mount
    useEffect(() => {
        void loadExportTasks({ silent: true });
    }, [loadExportTasks]);

    // Poll active export tasks
    useEffect(() => {
        if (activeExportTaskCount === 0) return;

        const timer = window.setInterval(() => {
            void loadExportTasks({ silent: true });
        }, EXPORT_TASK_POLL_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [activeExportTaskCount, loadExportTasks]);

    // Close export menus on backdrop click or Escape
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

    // Refresh tasks when export tasks menu opens
    useEffect(() => {
        if (!showExportTasksMenu) return;
        void loadExportTasks();
    }, [loadExportTasks, showExportTasksMenu]);

    // ==================== Return ====================

    return {
        // Export menu
        showExportMenu,
        setShowExportMenu,
        showExportTasksMenu,
        setShowExportTasksMenu,
        exportMenuRef,
        exportTasksMenuRef,
        exportState,
        exportTasks,
        loadingExportTasks,
        activeExportTaskCount,
        shouldShowExportTasksButton,

        // Execution tracking
        lastExecutedSql,

        // Result tabs
        savedResults,
        activeResultTab,
        setActiveResultTab,
        currentResultTabNumber,
        activeSavedResult,
        hasCurrentResultTab,
        displayedCurrentResult,
        displayedResult,
        displayedQueryError,
        currentResultCanPin,
        activeResultSql,
        activeResultDataSourceId,
        activeResultDatabase,

        // Actions
        handleRunQuery,
        handleFormat,
        handlePinCurrentResult,
        handleCloseSavedResult,
        handleToggleSavedResultPin,
        handleFillSavedSql,
        createAsyncExportTask,
        downloadExportTask,
        showExportFeedback,
        loadExportTasks,
    };
}
