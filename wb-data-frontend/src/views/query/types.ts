/**
 * Query 页面类型定义
 */

import { QueryResult } from '../../api/query';

// ==================== Monaco Editor ====================

export type MonacoEditorInstance = Monaco.editor.IStandaloneCodeEditor;

// ==================== Query ====================

export interface QueryEditorError {
    code?: string;
    response?: {
        data?: {
            message?: string;
        };
    };
    message?: string;
}

// ==================== Feedback ====================

export type QueryFeedbackState = 'idle' | 'running' | 'success' | 'empty' | 'message' | 'error' | 'timeout';

// ==================== Export ====================

export interface ExportState {
    status: 'idle' | 'exporting' | 'error';
    format?: 'csv' | 'xlsx';
    message?: string;
}

// ==================== Result ====================

export type ResultTabId = 'current' | string;

export interface SavedQueryResult {
    id: string;
    tabNumber: number;
    isPinned: boolean;
    sql: string;
    dataSourceId: string;
    dataSourceName: string;
    databaseName: string;
    executedAt: string;
    rowCount: number | null;
    executionTimeMs: number | null;
    result: QueryResult;
}
