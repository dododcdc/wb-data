/**
 * Query 页面 SQL 编辑器 hook (简化版)
 * 只管理 SQL 内容、查询执行和结果状态
 */

import { useState, useCallback } from 'react';
import { executeQuery, QueryResult } from '../../../api/query';

// ==================== 常量 ====================

const QUERY_EXECUTION_TIMEOUT_MS = 10_000;

// ==================== 类型 ====================

type QueryEditorError = {
  code?: string;
  response?: {
    data?: {
      message?: string;
    };
  };
  message?: string;
};

// ==================== Hook ====================

export interface UseQueryEditorReturn {
  // State
  sql: string;
  result: QueryResult | null;
  queryError: string;
  loadingQuery: boolean;

  // Setters (for backward compatibility)
  setResult: (result: QueryResult | null) => void;
  setQueryError: (error: string) => void;
  setLoadingQuery: (loading: boolean) => void;

  // Actions
  setSql: (sql: string) => void;
  executeQuery: (options?: {
    sqlToRun?: string;
    dataSourceId: string;
    database?: string;
    onBeforeExecute?: () => void;
    onResultPanelState?: (collapsed: boolean) => void;
  }) => Promise<void>;
}

export function useQueryEditor(): UseQueryEditorReturn {
  // State
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string>('');
  const [loadingQuery, setLoadingQuery] = useState(false);

  // Execute query
  const executeQueryAction = useCallback(async (options?: {
    sqlToRun?: string;
    dataSourceId: string;
    database?: string;
    onBeforeExecute?: () => void;
    onResultPanelState?: (collapsed: boolean) => void;
  }) => {
    const { sqlToRun, dataSourceId, database, onBeforeExecute, onResultPanelState } = options ?? {};

    // Use provided SQL or editor content
    const finalSql = sqlToRun ?? sql;

    // Validate
    if (!dataSourceId) {
      setResult(null);
      setQueryError('请先选择数据源后再执行 SQL。');
      onResultPanelState?.(false);
      return;
    }

    if (!finalSql.trim()) {
      setResult(null);
      setQueryError('请输入 SQL 语句后再执行。');
      onResultPanelState?.(false);
      return;
    }

    // Reset state before execution
    onBeforeExecute?.();
    setResult(null);
    setQueryError('');
    setLoadingQuery(true);

    try {
      const data = await executeQuery(Number(dataSourceId), finalSql, database);
      setResult(data);
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
      onResultPanelState?.(false);
    } finally {
      setLoadingQuery(false);
    }
  }, [sql]);

  return {
  sql,
  result,
  queryError,
  loadingQuery,
  // Setters
  setResult,
  setQueryError,
  setLoadingQuery,
  setSql,
  executeQuery: executeQueryAction,
};
}
