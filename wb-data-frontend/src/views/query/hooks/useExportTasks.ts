/**
 * Query 页面导出任务 hook
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createQueryExportTask, listQueryExportTasks, QueryExportTask } from '../../../api/query';
import { upsertExportTask } from '../exportUtils';
import { ExportState } from '../types';
import { EXPORT_TASK_POLL_INTERVAL_MS } from '../queryConstants';

// ==================== Hook 返回值 ====================

export interface UseExportTasksReturn {
    // State
    showExportMenu: boolean;
    showExportTasksMenu: boolean;
    exportState: ExportState;
    exportTasks: QueryExportTask[];
    loadingExportTasks: boolean;
    activeExportTaskCount: number;
    shouldShowExportTasksButton: boolean;

    // Setters
    setShowExportMenu: (show: boolean) => void;
    setShowExportTasksMenu: (show: boolean) => void;
    setExportState: (state: ExportState) => void;
    setExportTasks: (tasks: QueryExportTask[]) => void;
    setLoadingExportTasks: (loading: boolean) => void;

    // Actions
    showExportFeedback: (state: ExportState) => void;
    loadExportTasks: (opts?: { silent?: boolean }) => Promise<void>;
    createAsyncExportTask: (format: 'csv' | 'xlsx', opts?: {
        sql: string;
        dataSourceId: string;
        database: string;
    }) => Promise<void>;
    toggleExportMenu: () => void;
    toggleExportTasksMenu: () => void;

    // Refs
    exportStateTimerRef: React.MutableRefObject<number | null>;
    exportTasksMenuRef: React.MutableRefObject<HTMLDivElement | null>;
}

// ==================== Hook ====================

export function useExportTasks(): UseExportTasksReturn {
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showExportTasksMenu, setShowExportTasksMenu] = useState(false);
    const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });
    const [exportTasks, setExportTasks] = useState<QueryExportTask[]>([]);
    const [loadingExportTasks, setLoadingExportTasks] = useState(false);

    const exportStateTimerRef = useRef<number | null>(null);
    const exportTasksMenuRef = useRef<HTMLDivElement | null>(null);

    // Active task count
    const activeExportTaskCount = exportTasks.filter(
        task => task.status === 'PENDING' || task.status === 'RUNNING'
    ).length;

    const shouldShowExportTasksButton = exportTasks.length > 0 || loadingExportTasks;

    // Show export feedback with auto-dismiss
    const showExportFeedback = useCallback((nextState: ExportState) => {
        setExportState(nextState);

        if (exportStateTimerRef.current !== null) {
            window.clearTimeout(exportStateTimerRef.current);
            exportStateTimerRef.current = null;
        }

        if (nextState.status === 'idle') {
            return;
        }

        if (nextState.status === 'exporting') {
            exportStateTimerRef.current = window.setTimeout(() => {
                setExportState({ status: 'idle' });
                exportStateTimerRef.current = null;
            }, 3000);
        }
    }, []);

    // Load export tasks
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

    // Create export task
    const createAsyncExportTask = useCallback(async (
        format: 'csv' | 'xlsx',
        opts?: { sql: string; dataSourceId: string; database: string }
    ) => {
        if (!opts?.sql || !opts?.dataSourceId || !opts?.database) {
            showExportFeedback({ status: 'error', format, message: '请先成功执行查询后再创建导出任务。' });
            return;
        }

        showExportFeedback({ status: 'exporting', format, message: `正在创建 ${format === 'csv' ? 'CSV' : 'Excel'} 导出任务...` });

        try {
            const task = await createQueryExportTask({
                sql: opts.sql,
                dataSourceId: Number(opts.dataSourceId),
                databaseName: opts.database,
                format,
            });

            setExportTasks(prev => upsertExportTask(prev, task));
            showExportFeedback({ status: 'idle' });
            setShowExportMenu(false);
            setShowExportTasksMenu(true);
        } catch (error) {
            console.error('Failed to create export task', error);
            showExportFeedback({
                status: 'error',
                format,
                message: '创建导出任务失败，请稍后重试。',
            });
        }
    }, [showExportFeedback]);

    // Toggle menus
    const toggleExportMenu = useCallback(() => {
        setShowExportMenu(prev => !prev);
        if (showExportTasksMenu) {
            setShowExportTasksMenu(false);
        }
    }, [showExportTasksMenu]);

    const toggleExportTasksMenu = useCallback(() => {
        setShowExportTasksMenu(prev => !prev);
        if (showExportMenu) {
            setShowExportMenu(false);
        }
    }, [showExportMenu]);

    // Auto-dismiss export state on unmount
    useEffect(() => {
        return () => {
            if (exportStateTimerRef.current !== null) {
                window.clearTimeout(exportStateTimerRef.current);
            }
        };
    }, []);

    return {
        // State
        showExportMenu,
        showExportTasksMenu,
        exportState,
        exportTasks,
        loadingExportTasks,
        activeExportTaskCount,
        shouldShowExportTasksButton,

        // Setters
        setShowExportMenu,
        setShowExportTasksMenu,
        setExportState,
        setExportTasks,
        setLoadingExportTasks,

        // Actions
        showExportFeedback,
        loadExportTasks,
        createAsyncExportTask,
        toggleExportMenu,
        toggleExportTasksMenu,

        // Refs
        exportStateTimerRef,
        exportTasksMenuRef,
    };
}
